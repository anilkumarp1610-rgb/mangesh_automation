import argparse
import logging
import os
import re

from auth_client import authenticate
from config import load_config
from db import get_connection
from delivery import send_failure_email, send_success_email, upload_to_sftp
from export_invoices_csv import export_invoices_csv
from invoice_client import get_invoice
from logging_config import setup_logging
from repository import (
    get_invoice_numbers_for_payment_file,
    get_open_payment_files,
    insert_response_log,
    load_interface_configuration,
    start_batch_run,
    store_invoice_record,
    update_ap_invoice_status,
    update_payment_file_status,
)
from sync_payment_files import sync_payment_files

logger = logging.getLogger(__name__)

_UNSAFE_FILENAME_CHARS = re.compile(r"[^A-Za-z0-9_.-]")


def process_invoice(
    cursor,
    api_cfg,
    token: str,
    invoice_number: str,
    invoice_process_uuid: str,
    ap_payment_file_detail_id: int,
) -> str:
    logger.info("Invoice %s -- calling Get Invoice API", invoice_number)
    response = get_invoice(api_cfg, token, invoice_number)
    logger.info(
        "Invoice %s -- HTTP %s from %s", invoice_number, response.status_code, response.url
    )

    try:
        payload = response.json()
    except ValueError:
        payload = None
        logger.warning("Invoice %s -- response body was not valid JSON", invoice_number)

    log_id = insert_response_log(
        cursor,
        invoice_number=invoice_number,
        request_url=response.url,
        http_status_code=response.status_code,
        is_success=response.ok and bool(payload and payload.get("success")),
        response_message=(payload or {}).get("message"),
        response_body=payload,
        error_message=None if response.ok else response.text,
        invoice_process_uuid=invoice_process_uuid,
    )

    records = (payload.get("data") or {}).get("records") or [] if payload else []

    if not response.ok or not payload or not payload.get("success"):
        api_status = "FAILED"
    elif not records:
        api_status = "PENDING"
    else:
        api_status = "SUCCESS"

    logger.info(
        "Invoice %s -- updating ap_invoices (status=%s, http=%s)",
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
        logger.warning("Invoice %s -- status=%s, no detail rows stored", invoice_number, api_status)
        return api_status

    for record in records:
        store_invoice_record(
            cursor, record, log_id, invoice_process_uuid, ap_payment_file_detail_id
        )
    logger.info(
        "Invoice %s -- status=SUCCESS, stored %d record(s) into detail tables",
        invoice_number,
        len(records),
    )
    return api_status


def process_payment_file(conn, cursor, cfg, token: str, payment_file: dict) -> None:
    payment_file_detail_id = payment_file["id"]
    batch_name = payment_file.get("ap_batch_name") or str(payment_file_detail_id)
    logger.info("=== Payment file %s (id=%s): starting ===", batch_name, payment_file_detail_id)

    invoice_process_uuid = None
    try:
        logger.info(
            "Payment file %s: Step 5 -- starting run (fresh invoice_process_uuid)", batch_name
        )
        invoice_process_uuid = start_batch_run(cursor, payment_file_detail_id)
        conn.commit()
        logger.info(
            "Payment file %s: invoice_process_uuid=%s",
            batch_name,
            invoice_process_uuid,
        )

        logger.info(
            "Payment file %s: Step 4 -- pulling invoice numbers for payment_file_id=%s",
            batch_name,
            payment_file_detail_id,
        )
        invoice_numbers = get_invoice_numbers_for_payment_file(cursor, payment_file_detail_id)
        if not invoice_numbers:
            logger.warning("Payment file %s: no invoices found -- nothing to process", batch_name)
        else:
            logger.info(
                "Payment file %s: found %d invoice(s) to process", batch_name, len(invoice_numbers)
            )

        logger.info("Payment file %s: Step 6 -- processing invoices", batch_name)
        status_counts = {"SUCCESS": 0, "PENDING": 0, "FAILED": 0}
        for invoice_number in invoice_numbers:
            status = process_invoice(
                cursor, cfg.invoice_api, token, invoice_number, invoice_process_uuid, payment_file_detail_id
            )
            status_counts[status] = status_counts.get(status, 0) + 1
            conn.commit()

        logger.info(
            "Payment file %s: Step 6 complete -- %d SUCCESS, %d PENDING, %d FAILED",
            batch_name,
            status_counts["SUCCESS"],
            status_counts["PENDING"],
            status_counts["FAILED"],
        )
        batch_status = "Failure" if status_counts["FAILED"] else "Success"
        if batch_status == "Failure":
            logger.warning(
                "Payment file %s: %d invoice(s) FAILED -- batch will be marked Failure and the "
                "failure notification will be sent instead of the success email",
                batch_name,
                status_counts["FAILED"],
            )

        filename_suffix = _UNSAFE_FILENAME_CHARS.sub("_", batch_name)
        output_filename = cfg.output.file_name
        logger.info("Payment file %s: generating CSV export", batch_name)
        output_path = export_invoices_csv(
            cfg, invoice_process_uuid=invoice_process_uuid, filename_suffix=filename_suffix
        )
        output_filename = os.path.basename(output_path)
        logger.info("Payment file %s: CSV export written to %s", batch_name, output_path)

        logger.info(
            "Payment file %s: uploading %s to SFTP (%s)",
            batch_name,
            output_filename,
            cfg.sftp.host,
        )
        upload_to_sftp(cfg.sftp, output_path, output_filename)
        logger.info("Payment file %s: SFTP upload complete", batch_name)

        if batch_status == "Success":
            logger.info("Payment file %s: sending success email", batch_name)
            send_success_email(cfg.email, output_filename, output_path)
            logger.info("Payment file %s: success email sent (or skipped -- Email.Enabled=false)", batch_name)
        else:
            logger.info("Payment file %s: sending failure notification email", batch_name)
            send_failure_email(
                cfg.email,
                output_filename,
                RuntimeError(
                    f"{status_counts['FAILED']} of {len(invoice_numbers)} invoice(s) failed "
                    f"while processing payment file {batch_name}"
                ),
            )
            logger.info(
                "Payment file %s: failure email sent (or skipped -- FailureNotification.Enabled=false)",
                batch_name,
            )
    except Exception as error:
        logger.exception(
            "Payment file %s (id=%s): processing failed -- %s: %s",
            batch_name,
            payment_file_detail_id,
            type(error).__name__,
            error,
        )
        try:
            conn.rollback()
        except Exception:
            logger.exception("Payment file %s: rollback failed", batch_name)
        try:
            update_payment_file_status(cursor, payment_file_detail_id, "Failure")
            conn.commit()
            logger.info("Payment file %s: marked Failure", batch_name)
        except Exception:
            logger.exception(
                "Payment file %s: could not update ap_payment_file_details to Failure", batch_name
            )
            try:
                conn.rollback()
            except Exception:
                logger.exception("Payment file %s: rollback failed", batch_name)
        try:
            logger.info("Payment file %s: sending failure notification email", batch_name)
            send_failure_email(cfg.email, cfg.output.file_name, error)
        except Exception:
            logger.exception("Payment file %s: failure notification could not be sent", batch_name)
        return

    update_payment_file_status(cursor, payment_file_detail_id, batch_status)
    conn.commit()
    logger.info("=== Payment file %s: done, marked %s ===", batch_name, batch_status)


def main(interface_id: int | None = None) -> None:
    """Entry point. `interface_id` is required; pass it directly when calling this
    from other Python code (e.g. an Airflow PythonOperator) -- CLI usage instead
    reads it from --interface-id via argparse."""
    if interface_id is None:
        parser = argparse.ArgumentParser(description="Process AP invoices for a given interface.")
        parser.add_argument(
            "--interface-id",
            type=int,
            required=True,
            dest="interface_id",
            help="interfaceconfiguration.InterfaceId to process",
        )
        interface_id = parser.parse_args().interface_id

    try:
        cfg = load_config()
        log_file = setup_logging(cfg.logging)
    except Exception:
        # logging isn't configured yet at this point (it depends on the config we just
        # failed to load), so this is the one failure in the whole run that can't reach
        # the log file -- print it so it's at least visible on the console/stderr.
        import traceback

        traceback.print_exc()
        raise
    logger.info("=== process_invoices run starting for InterfaceId=%s ===", interface_id)
    logger.info("Logging this run to %s", log_file)

    logger.info("Connecting to MySQL at %s/%s", cfg.mysql.host, cfg.mysql.database)
    try:
        conn = get_connection(cfg.mysql)
    except Exception:
        logger.exception("Could not connect to MySQL at %s/%s", cfg.mysql.host, cfg.mysql.database)
        raise
    cursor = conn.cursor(dictionary=True)
    try:
        try:
            logger.info(
                "Step 1-2: loading interface configuration for InterfaceId=%s", interface_id
            )
            interface_values = load_interface_configuration(cursor, interface_id)
            cfg = load_config(interface_values=interface_values)
            logger.info("Step 1-2: interface configuration loaded")

            logger.info("Authenticating against %s", cfg.invoice_api.base_uri)
            token = authenticate(cfg.invoice_api)
            logger.info("Authentication successful")

            logger.info(
                "Step 2a: pulling new payment files + invoice numbers from upstream API "
                "for InterfaceId=%s",
                interface_id,
            )
            new_payment_file_detail_ids = sync_payment_files(cursor, cfg, token, interface_id)
            conn.commit()
            logger.info(
                "Step 2a: synced %d new payment file(s) for InterfaceId=%s",
                len(new_payment_file_detail_ids),
                interface_id,
            )

            logger.info("Step 3: querying open ('New') payment files for InterfaceId=%s", interface_id)
            payment_files = get_open_payment_files(cursor, interface_id)
            logger.info(
                "Step 3: found %d open ('New') payment file(s) for InterfaceId=%s",
                len(payment_files),
                interface_id,
            )
        except Exception:
            logger.exception(
                "Run setup failed for InterfaceId=%s before any payment file could be processed",
                interface_id,
            )
            raise

        for payment_file in payment_files:
            process_payment_file(conn, cursor, cfg, token, payment_file)
    finally:
        try:
            cursor.close()
        except Exception:
            logger.exception("Error closing DB cursor")
        try:
            conn.close()
        except Exception:
            logger.exception("Error closing DB connection")
        logger.info("=== process_invoices run finished for InterfaceId=%s ===", interface_id)


if __name__ == "__main__":
    main()
