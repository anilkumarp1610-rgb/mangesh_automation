import logging
from datetime import datetime, timedelta, timezone

from config import AppConfig
from invoice_client import get_invoice_list, get_payment_batches
from repository import (
    insert_ap_invoice,
    insert_batch_invoice_allocation_value,
    insert_batch_invoice_custom,
    insert_batch_invoice_detail,
    insert_payment_file,
)

logger = logging.getLogger(__name__)


def _fetch_all_pages(call, api_label: str) -> list:
    """call(page) -> requests.Response for one page; follows data.totalPages
    until every page has been collected."""
    records = []
    page = 1
    while True:
        logger.debug("%s: page %s -- in process", api_label, page)
        response = call(page)
        response.raise_for_status()
        payload = response.json()
        if not payload.get("success"):
            logger.error("%s: page %s -- failed (%s)", api_label, page, payload.get("message"))
            raise RuntimeError(f"{api_label} failed: {payload.get('message')}")

        data = payload.get("data") or {}
        page_records = data.get("records") or []
        records.extend(page_records)
        total_pages = data.get("totalPages") or 1
        logger.debug(
            "%s: page %s -- success (%d record(s), %s/%s pages)",
            api_label,
            page,
            len(page_records),
            page,
            total_pages,
        )

        if page >= total_pages or not page_records:
            break
        page += 1

    return records


def sync_payment_files(cursor, cfg: AppConfig, token: str, interface_id: int) -> list:
    """Step 1: pull every payment-file batch the upstream API returns for the
    configured date window and insert a fresh ap_payment_file_details row for
    EACH one, every run -- no existence check against a prior run's row. A
    paymentFileId that reappears (which it will, at least once, since
    GetPaymentBatches.LookbackDays deliberately overlaps day to day) gets a
    brand-new id and is fully reprocessed from scratch: new invoice list pull,
    new ap_invoices rows, new Get Invoice calls, new CSV/SFTP/email. This is a
    deliberate choice -- a payment file's invoice list can grow or shrink on
    the vendor's side, and re-running the whole chain from a fresh id is
    simpler and safer than trying to diff and patch an existing one. Cost is
    naturally bounded by the date window itself: once a payment file ages out
    of [today - LookbackDays, today], the API stops returning it and it stops
    being reprocessed.

    Step 2 for every batch: pull its invoice list from the upstream API and
    insert the invoice numbers into ap_invoices. Returns the
    ap_payment_file_details.id values inserted this run."""
    batches_cfg = cfg.invoice_api.get_payment_batches
    to_date = datetime.now(timezone.utc).date()
    from_date = to_date - timedelta(days=batches_cfg.lookback_days)

    logger.info(
        "Payment file sync: pulling payment batches from %s to %s for InterfaceId=%s",
        from_date,
        to_date,
        interface_id,
    )
    batch_records = _fetch_all_pages(
        lambda page: get_payment_batches(
            cfg.invoice_api, token, from_date.isoformat(), to_date.isoformat(), page
        ),
        "Get Payment Batches API",
    )
    logger.info("Payment file sync: %d payment batch record(s) returned", len(batch_records))

    new_payment_file_detail_ids = []

    for record in batch_records:
        payment_file_id = record.get("paymentFileId")
        batch_name = record.get("apBatchName") or str(payment_file_id)
        payment_file_detail_id = insert_payment_file(
            cursor, interface_id, payment_file_id, batch_name, record
        )
        new_payment_file_detail_ids.append(payment_file_detail_id)
        logger.info(
            "Payment file sync: inserted %s (paymentFileId=%s) as ap_payment_file_details.id=%s",
            batch_name,
            payment_file_id,
            payment_file_detail_id,
        )

        logger.info(
            "Payment file sync: pulling invoice list for %s (paymentFileId=%s)",
            batch_name,
            payment_file_id,
        )
        detail_records = _fetch_all_pages(
            lambda page: get_invoice_list(cfg.invoice_api, token, payment_file_id, page),
            "Get Invoice List API",
        )
        logger.info(
            "Payment file sync: %d invoice-list record(s) returned for %s",
            len(detail_records),
            batch_name,
        )

        invoice_numbers = set()
        for detail_record in detail_records:
            detail_batch_name = detail_record.get("apBatchName") or batch_name
            for line in detail_record.get("invoiceAPBatchDetails") or []:
                batch_invoice_detail_id = insert_batch_invoice_detail(
                    cursor, payment_file_detail_id, detail_batch_name, line
                )
                for allocation_record in line.get("allocationValues") or []:
                    insert_batch_invoice_allocation_value(
                        cursor, batch_invoice_detail_id, allocation_record
                    )
                for custom_record in line.get("custom") or []:
                    insert_batch_invoice_custom(cursor, batch_invoice_detail_id, custom_record)

                invoice_number = line.get("invoiceNumber")
                if invoice_number:
                    invoice_numbers.add(invoice_number)

        # No need to check ap_invoices for already-stored invoice numbers here:
        # payment_file_detail_id is always a brand-new AUTO_INCREMENT id (see
        # docstring -- every batch gets a fresh row every run), so no
        # ap_invoices row could possibly reference it yet. invoice_numbers is
        # already deduplicated within this run via the set() built above.
        for invoice_number in sorted(invoice_numbers):
            insert_ap_invoice(cursor, payment_file_detail_id, invoice_number)
        logger.info(
            "Payment file sync: stored %d invoice number(s) for %s",
            len(invoice_numbers),
            batch_name,
        )

    return new_payment_file_detail_ids
