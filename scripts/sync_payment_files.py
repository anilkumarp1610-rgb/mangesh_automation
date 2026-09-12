import logging
from datetime import datetime, timedelta, timezone

from config import AppConfig
from invoice_client import get_invoice_list, get_payment_batches
from repository import (
    get_existing_payment_file_ids,
    get_invoice_numbers_for_payment_file,
    insert_ap_invoice,
    insert_batch_details,
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
        response = call(page)
        response.raise_for_status()
        payload = response.json()
        if not payload.get("success"):
            raise RuntimeError(f"{api_label} failed: {payload.get('message')}")

        data = payload.get("data") or {}
        page_records = data.get("records") or []
        records.extend(page_records)

        total_pages = data.get("totalPages") or 1
        if page >= total_pages or not page_records:
            break
        page += 1

    return records


def sync_payment_files(cursor, cfg: AppConfig, token: str, interface_id: int) -> list:
    """Step 1: pull payment-file batches from the upstream API and insert the
    new ones into ap_payment_file_details. Step 2 for each new batch: pull its
    invoice list from the upstream API and insert the invoice numbers into
    ap_invoices. Returns the ap_payment_file_details.id values just inserted."""
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

    existing_payment_file_ids = get_existing_payment_file_ids(cursor, interface_id)
    new_payment_file_detail_ids = []

    for record in batch_records:
        payment_file_id = record.get("paymentFileId")
        if payment_file_id in existing_payment_file_ids:
            logger.debug(
                "Payment file sync: paymentFileId=%s already exists for InterfaceId=%s -- skipping",
                payment_file_id,
                interface_id,
            )
            continue

        batch_name = record.get("apBatchName") or str(payment_file_id)
        payment_file_detail_id = insert_payment_file(
            cursor, interface_id, payment_file_id, batch_name
        )
        existing_payment_file_ids.add(payment_file_id)
        new_payment_file_detail_ids.append(payment_file_detail_id)
        logger.info(
            "Payment file sync: inserted %s (paymentFileId=%s) as ap_payment_file_details.id=%s",
            batch_name,
            payment_file_id,
            payment_file_detail_id,
        )
        insert_batch_details(cursor, payment_file_detail_id, record)

        logger.info(
            "Payment file sync: pulling invoice list for %s (paymentFileId=%s)",
            batch_name,
            payment_file_id,
        )
        detail_records = _fetch_all_pages(
            lambda page: get_invoice_list(cfg.invoice_api, token, payment_file_id, page),
            "Get Invoice List API",
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

        already_stored = set(
            get_invoice_numbers_for_payment_file(cursor, payment_file_detail_id)
        )
        new_invoice_numbers = sorted(invoice_numbers - already_stored)

        for invoice_number in new_invoice_numbers:
            insert_ap_invoice(cursor, payment_file_detail_id, invoice_number)
        logger.info(
            "Payment file sync: stored %d new invoice number(s) for %s (%d already present)",
            len(new_invoice_numbers),
            batch_name,
            len(invoice_numbers) - len(new_invoice_numbers),
        )

    return new_payment_file_detail_ids
