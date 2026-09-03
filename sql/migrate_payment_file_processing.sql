-- ============================================================================
-- Catch-up migration for databases that already have interfaceconfiguration,
-- ap_payment_file_details, ap_invoices_process_log and invoice_summary, but
-- predate payment-file-scoped processing (see process_invoices.py --interface-id).
--
-- create_tables.sql's CREATE TABLE IF NOT EXISTS statements are no-ops against
-- a database like this one -- the tables already exist, so those statements
-- never fire and never touch existing columns. Run this script once instead to
-- bring an existing installation's schema up to date.
--
-- A brand new installation does NOT need this file -- create_tables.sql alone
-- already creates every table in its final shape.
-- ============================================================================

USE airflow;

-- ap_invoices_process_log.id currently has no AUTO_INCREMENT (rows were only
-- ever supplied with an explicit id by other tables' upstream loaders); the
-- pipeline now inserts one row per payment-file run and needs MySQL to assign it.
ALTER TABLE ap_invoices_process_log
    MODIFY id INT NOT NULL AUTO_INCREMENT;

-- invoice_summary already has invoice_process_uuid; it's still missing the
-- payment-file link that scopes output generation to a single run.
ALTER TABLE invoice_summary
    ADD COLUMN ap_payment_file_detail_id INT DEFAULT NULL AFTER invoice_process_uuid;

ALTER TABLE ap_invoices_process_log
    ADD CONSTRAINT fk_process_log_payment_file
    FOREIGN KEY (ap_payment_file_detail_id) REFERENCES ap_payment_file_details (id);

ALTER TABLE invoice_summary
    ADD CONSTRAINT fk_summary_payment_file
    FOREIGN KEY (ap_payment_file_detail_id) REFERENCES ap_payment_file_details (id);
