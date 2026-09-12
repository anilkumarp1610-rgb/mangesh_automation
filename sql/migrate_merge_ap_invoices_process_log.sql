-- ============================================================================
-- Merges ap_invoices_process_log into ap_payment_file_details.
--
-- Background: ap_invoices_process_log held one row per processing RUN of a
-- payment-file batch (proces_datetime, invoice_process_uuid), with
-- ap_payment_file_details.log_id pointing at the latest one. In principle a
-- batch could be reprocessed (flipped back to 'New' after a failure) and
-- accumulate multiple historical run rows -- but in practice a batch is only
-- ever processed by one active run at a time, and the tracker's own "Run
-- Logs" / "Run detail" pages built on that history were retired alongside
-- this table (see tracker/README.md and the tracker frontend/backend
-- changes made in this same change set).
--
-- ap_payment_file_details keeps proces_datetime's job implicitly (a run
-- starts and finishes within the same process_payment_file() call, and
-- processed_date already records completion) and gains
-- invoice_process_uuid to hold the CURRENT run's identifier directly.
-- log_id is dropped since there is no longer a separate table for it to
-- reference.
--
-- If a payment file has more than one ap_invoices_process_log row (a
-- reprocessed batch), only the LATEST one's UUID is kept -- matching what
-- ap_payment_file_details.log_id already pointed at before this migration.
-- ============================================================================

USE airflow;

ALTER TABLE ap_payment_file_details
    ADD COLUMN invoice_process_uuid VARCHAR(45) AFTER processed_date;

UPDATE ap_payment_file_details b
JOIN (
    SELECT pl1.ap_payment_file_detail_id, pl1.invoice_process_uuid
    FROM ap_invoices_process_log pl1
    WHERE pl1.id = (
        SELECT MAX(pl2.id)
        FROM ap_invoices_process_log pl2
        WHERE pl2.ap_payment_file_detail_id = pl1.ap_payment_file_detail_id
    )
) latest ON latest.ap_payment_file_detail_id = b.id
SET b.invoice_process_uuid = latest.invoice_process_uuid;

ALTER TABLE ap_payment_file_details
    DROP COLUMN log_id;

DROP TABLE IF EXISTS ap_invoices_process_log;
