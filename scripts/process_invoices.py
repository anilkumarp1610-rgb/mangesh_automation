import argparse
import logging
import os
from datetime import date, datetime

from auth_client import authenticate
from config import load_config
from db import dispose_engines, get_connection
from db_log_handler import DbLogHandler
from delivery import send_no_batch_email, send_run_summary_email, upload_to_sftp
from export_invoices_csv import export_ap_batch_csv
from invoice_client import get_invoice
from log_context import current_payment_file_detail_id
from logging_config import LOG_FORMAT, setup_logging
from repository import (
    get_invoice_ids_by_number,
    get_open_payment_files,
    insert_response_log,
    insert_run_log,
    load_interface_configuration,
    start_batch_run,
    store_invoice_record,
    update_ap_invoice_status,
    update_payment_file_status,
)
from sync_payment_files import resolve_date_window, sync_payment_files

logger = logging.getLogger(__name__)


def _parse_date_arg(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise argparse.ArgumentTypeError(f"invalid date {value!r} -- expected YYYY-MM-DD")


def process_invoice(
    cursor,
    api_cfg,
    token: str,
    invoice_number: str,
    ap_invoice_ids: list,
    invoice_process_uuid: str,
    ap_payment_file_detail_id: int,
    run_log_id: int,
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
        ap_invoice_ids=ap_invoice_ids,
        payment_file_detail_id=ap_payment_file_detail_id,
        run_log_id=run_log_id,
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


def process_payment_file(conn, cursor, cfg, token: str, payment_file: dict) -> dict:
    """Runs one open batch end to end (see below) and returns a result dict
    -- {"batch_name", "invoice_count", "output_path", "output_filename",
    "status"} -- describing what happened, instead of emailing per batch.
    main() collects one of these per batch processed this run and sends a
    single run-level summary email at the end (delivery.send_run_summary_email)."""
    payment_file_detail_id = payment_file["id"]
    batch_name = payment_file.get("ap_batch_name") or str(payment_file_detail_id)
    result = {
        "batch_name": batch_name,
        "invoice_count": 0,
        "output_path": None,
        "output_filename": None,
        "status": "Failure",
    }

    # Tags every log record emitted anywhere below (including from process_invoice())
    # with this batch's id, via db_log_handler.DbLogHandler -- see log_context.py.
    context_token = current_payment_file_detail_id.set(payment_file_detail_id)
    try:
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
            invoice_ids_by_number = get_invoice_ids_by_number(
                cursor, payment_file_detail_id, payment_file["run_log_id"]
            )
            invoice_numbers = list(invoice_ids_by_number)
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
                    cursor,
                    cfg.invoice_api,
                    token,
                    invoice_number,
                    invoice_ids_by_number[invoice_number],
                    invoice_process_uuid,
                    payment_file_detail_id,
                    payment_file["run_log_id"],
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
            result["invoice_count"] = len(invoice_numbers)
            if batch_status == "Failure":
                logger.warning(
                    "Payment file %s: %d invoice(s) FAILED -- batch will be marked Failure "
                    "(included in the run summary email as usual, see main())",
                    batch_name,
                    status_counts["FAILED"],
                )

            logger.info("Payment file %s: generating AP output CSV", batch_name)
            output_path = export_ap_batch_csv(
                cfg, payment_file_detail_id, payment_file.get("ap_created_date")
            )
            output_filename = os.path.basename(output_path)
            result["output_path"] = output_path
            result["output_filename"] = output_filename
            logger.info("Payment file %s: AP output CSV written to %s", batch_name, output_path)

            logger.info(
                "Payment file %s: uploading %s to SFTP (%s)",
                batch_name,
                output_filename,
                cfg.sftp.host,
            )
            upload_to_sftp(cfg.sftp, output_path, output_filename)
            logger.info("Payment file %s: SFTP upload complete", batch_name)
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
            result["status"] = "Failure"
            return result

        update_payment_file_status(cursor, payment_file_detail_id, batch_status)
        conn.commit()
        result["status"] = batch_status
        logger.info("=== Payment file %s: done, marked %s ===", batch_name, batch_status)
        return result
    finally:
        current_payment_file_detail_id.reset(context_token)


def main(
    interface_id: int | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    ap_batch_name: str | None = None,
) -> None:
    """Entry point. `interface_id` is required; pass it directly when calling this
    from other Python code (e.g. an Airflow PythonOperator) -- CLI usage instead
    reads it from --interface-id via argparse.

    from_date/to_date optionally restrict the GetPaymentBatches date window pulled
    in sync_payment_files (default: the last GetPaymentBatches.LookbackDays day(s)
    ending today). CLI usage reads these from the optional trailing date argument(s):
    one date (YYYY-MM-DD) for that single day, or two dates for a from/to range.

    ap_batch_name, if given, pulls that single named batch instead -- no date
    window at all (mutually exclusive with the date argument(s) on the CLI)."""
    if interface_id is None:
        parser = argparse.ArgumentParser(description="Process AP invoices for a given interface.")
        parser.add_argument(
            "--interface-id",
            type=int,
            required=True,
            dest="interface_id",
            help="interfaceconfiguration.InterfaceId to process",
        )
        parser.add_argument(
            "--ap-batch-name",
            dest="ap_batch_name",
            metavar="NAME",
            help=(
                "Process a single payment-file batch by its exact ApBatchName instead of a "
                "date window (e.g. 'Kaiser Permanente_AP_Payment_File_2026-09-01 14:43:11'). "
                "Mutually exclusive with the DATE argument(s)."
            ),
        )
        parser.add_argument(
            "dates",
            nargs="*",
            type=_parse_date_arg,
            metavar="DATE",
            help=(
                "Optional GetPaymentBatches date filter: a single date (YYYY-MM-DD) to "
                "process just that day, or two dates (YYYY-MM-DD YYYY-MM-DD) for a range. "
                "Defaults to the last GetPaymentBatches.LookbackDays day(s) ending today. "
                "Not allowed together with --ap-batch-name."
            ),
        )
        args = parser.parse_args()
        interface_id = args.interface_id
        ap_batch_name = args.ap_batch_name
        if ap_batch_name and args.dates:
            parser.error("--ap-batch-name cannot be combined with DATE argument(s)")
        elif len(args.dates) == 1:
            from_date = to_date = args.dates[0]
        elif len(args.dates) == 2:
            from_date, to_date = args.dates
            if from_date > to_date:
                parser.error(f"start date {from_date} is after end date {to_date}")
        elif len(args.dates) > 2:
            parser.error("expected at most 2 date arguments (a single date or a from/to range)")

    try:
        cfg = load_config()
        setup_logging(cfg.logging)
    except Exception:
        # logging isn't configured yet at this point (it depends on the config we just
        # failed to load), and the DB-backed logger needs a DB connection we don't have
        # yet either -- this is the one failure in the whole run that can't reach any
        # logger at all, so print it so it's at least visible on the console/stderr.
        import traceback

        traceback.print_exc()
        raise
    logger.info("=== process_invoices run starting for InterfaceId=%s ===", interface_id)

    logger.info("Connecting to MySQL at %s/%s", cfg.mysql.host, cfg.mysql.database)
    try:
        conn = get_connection(cfg.mysql)
    except Exception:
        logger.exception("Could not connect to MySQL at %s/%s", cfg.mysql.host, cfg.mysql.database)
        raise
    cursor = conn.cursor(dictionary=True)
    try:
        # Marks the start of this run -- inserted and committed on its own, ahead of
        # everything else, so the record survives even if the run fails before
        # reaching a normal commit point.
        run_log_id = insert_run_log(
            cursor, interface_id, from_date=from_date, to_date=to_date, ap_batch_name=ap_batch_name
        )
        conn.commit()
        logger.info("Run log: inserted ap_run_log.id=%s for InterfaceId=%s", run_log_id, interface_id)

        # From here on, every log record (this process and any it calls into) is also
        # persisted to ap_process_log, tagged with run_log_id (and, inside a batch's
        # processing block, that batch's ap_payment_file_detail_id -- see log_context.py).
        db_log_handler = DbLogHandler(cfg.mysql, run_log_id)
        db_log_handler.setFormatter(logging.Formatter(LOG_FORMAT))
        logging.getLogger().addHandler(db_log_handler)
    except Exception:
        # DbLogHandler isn't attached yet at this point (or failed to attach), so
        # this failure can only reach the console -- same limitation as the
        # config-load failure above.
        logger.exception(
            "Could not initialize the run for InterfaceId=%s (ap_run_log insert or "
            "DbLogHandler setup failed)",
            interface_id,
        )
        try:
            cursor.close()
        except Exception:
            logger.exception("Error closing DB cursor")
        try:
            conn.close()
        except Exception:
            logger.exception("Error closing DB connection")
        raise

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

            if ap_batch_name:
                filter_note = f" (single batch: {ap_batch_name!r})"
            elif from_date:
                filter_note = f" (date window override: {from_date} to {to_date})"
            else:
                filter_note = ""
            logger.info(
                "Step 2a: pulling new payment files + invoice numbers from upstream API "
                "for InterfaceId=%s%s",
                interface_id,
                filter_note,
            )
            new_payment_file_detail_ids = sync_payment_files(
                cursor,
                cfg,
                token,
                interface_id,
                from_date=from_date,
                to_date=to_date,
                ap_batch_name=ap_batch_name,
                run_log_id=run_log_id,
                conn=conn,
            )
            conn.commit()
            logger.info(
                "Step 2a: synced %d new payment file(s) for InterfaceId=%s",
                len(new_payment_file_detail_ids),
                interface_id,
            )

            logger.info(
                "Step 3: querying open ('New') payment files for InterfaceId=%s, run_log_id=%s",
                interface_id,
                run_log_id,
            )
            payment_files = get_open_payment_files(cursor, interface_id, run_log_id)
            logger.info(
                "Step 3: found %d open ('New') payment file(s) for InterfaceId=%s, run_log_id=%s",
                len(payment_files),
                interface_id,
                run_log_id,
            )
        except Exception:
            logger.exception(
                "Run setup failed for InterfaceId=%s before any payment file could be processed",
                interface_id,
            )
            raise

        if not payment_files:
            logger.warning(
                "No AP batch found for InterfaceId=%s, run_log_id=%s -- sending no-batch email",
                interface_id,
                run_log_id,
            )
            email_from, email_to = (None, None)
            if not ap_batch_name:
                email_from, email_to = resolve_date_window(cfg, from_date, to_date)
            try:
                send_no_batch_email(
                    cfg.email,
                    cfg.job.output_prefix,
                    interface_id,
                    run_log_id,
                    datetime.now().strftime("%m/%d/%Y"),
                    from_date=email_from,
                    to_date=email_to,
                    ap_batch_name=ap_batch_name,
                    api_batch_count=len(new_payment_file_detail_ids),
                )
                logger.info("No-batch email sent (or skipped -- Email.Enabled=false)")
            except Exception:
                logger.exception("No-batch email could not be sent")

        batch_results = [
            process_payment_file(conn, cursor, cfg, token, payment_file)
            for payment_file in payment_files
        ]

        if batch_results:
            logger.info(
                "Sending run summary email for %d batch(es) processed this run", len(batch_results)
            )
            try:
                send_run_summary_email(
                    cfg.email,
                    cfg.job.output_prefix,
                    datetime.now().strftime("%m/%d/%Y"),
                    batch_results,
                    sftp_path=cfg.sftp.remote_directory,
                )
                logger.info(
                    "Run summary email sent (or skipped -- Email.Enabled=false)"
                )
            except Exception:
                logger.exception("Run summary email could not be sent")
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
        logging.getLogger().removeHandler(db_log_handler)
        db_log_handler.close()
        dispose_engines()


if __name__ == "__main__":
    main()
