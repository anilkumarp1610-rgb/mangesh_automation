import logging

import pandas as pd

from auth_client import authenticate
from config import load_config
from db import get_connection
from export_invoices_csv import export_invoices_csv
from invoice_client import get_invoice
from logging_config import setup_logging
from repository import insert_response_log, store_invoice_record, update_ap_invoice_status

logger = logging.getLogger(__name__)


def get_invoice_numbers(cursor) -> pd.DataFrame:
    logger.info("Step 2: fetching invoice numbers from ap_invoices")
    cursor.execute(
        "SELECT DISTINCT ap_invoice_number FROM airflow.ap_invoices "
        "WHERE ap_invoice_number IS NOT NULL"
    )
    rows = cursor.fetchall()
    df = pd.DataFrame(rows, columns=["ap_invoice_number"])

    if df.empty:
        logger.warning(
            "Step 2: no invoice numbers found in ap_invoices "
            "(ap_invoice_number IS NOT NULL) -- nothing will be processed this run"
        )
    else:
        logger.info("Step 2: found %d distinct invoice number(s) to process", len(df))

    return df


def process_invoice(cursor, api_cfg, token: str, invoice_number: str) -> str:
    logger.info("Step 3: invoice %s -- calling Get Invoice API", invoice_number)
    response = get_invoice(api_cfg, token, invoice_number)
    logger.info(
        "Step 3: invoice %s -- HTTP %s from %s",
        invoice_number,
        response.status_code,
        response.url,
    )

    try:
        payload = response.json()
    except ValueError:
        payload = None
        logger.warning("Step 3: invoice %s -- response body was not valid JSON", invoice_number)

    log_id = insert_response_log(
        cursor,
        invoice_number=invoice_number,
        request_url=response.url,
        http_status_code=response.status_code,
        is_success=response.ok and bool(payload and payload.get("success")),
        response_message=(payload or {}).get("message"),
        response_body=payload,
        error_message=None if response.ok else response.text,
    )

    records = (payload.get("data") or {}).get("records") or [] if payload else []

    if not response.ok or not payload or not payload.get("success"):
        api_status = "FAILED"
    elif not records:
        api_status = "PENDING"
    else:
        api_status = "SUCCESS"

    logger.info(
        "Step 4: invoice %s -- updating ap_invoices (status=%s, http=%s)",
        invoice_number,
        api_status,
        response.status_code,
    )
    update_ap_invoice_status(
        cursor,
        invoice_number=invoice_number,
        api_status=api_status,
        response_obj=payload,
        response_status_code=response.status_code,
    )

    if api_status != "SUCCESS":
        logger.warning(
            "Step 3: invoice %s -- status=%s, no detail rows stored",
            invoice_number,
            api_status,
        )
        return api_status

    for record in records:
        store_invoice_record(cursor, record, log_id)
    logger.info(
        "Step 3: invoice %s -- status=SUCCESS, stored %d record(s) into detail tables",
        invoice_number,
        len(records),
    )
    return api_status


def main() -> None:
    cfg = load_config()
    log_file = setup_logging(cfg.logging)
    logger.info("Logging this run to %s", log_file)

    logger.info("Step 1: authenticating against %s", cfg.invoice_api.base_uri)
    try:
        token = authenticate(cfg.invoice_api)
    except Exception:
        logger.exception("Step 1: authentication failed")
        raise
    logger.info("Step 1: authentication successful")

    conn = get_connection(cfg.mysql)
    cursor = conn.cursor(dictionary=True)
    status_counts = {"SUCCESS": 0, "PENDING": 0, "FAILED": 0}
    try:
        invoice_numbers_df = get_invoice_numbers(cursor)
        cursor = conn.cursor()  # plain cursor for the write path below

        for invoice_number in invoice_numbers_df["ap_invoice_number"]:
            status = process_invoice(cursor, cfg.invoice_api, token, invoice_number)
            status_counts[status] = status_counts.get(status, 0) + 1
            conn.commit()

        logger.info(
            "Steps 2-4 complete: %d SUCCESS, %d PENDING, %d FAILED",
            status_counts["SUCCESS"],
            status_counts["PENDING"],
            status_counts["FAILED"],
        )
    except Exception:
        logger.exception("Pipeline run failed -- rolling back")
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()

    logger.info("Step 5: generating output CSV")
    try:
        output_path = export_invoices_csv(cfg)
        logger.info("Step 5: CSV export written to %s", output_path)
    except Exception:
        logger.exception("Step 5: CSV export failed")
        raise


if __name__ == "__main__":
    main()
