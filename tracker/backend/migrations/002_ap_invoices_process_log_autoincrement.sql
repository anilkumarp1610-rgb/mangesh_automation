-- Tracker migration 002
-- ap_invoices_process_log.id has no AUTO_INCREMENT on this instance (the repo's
-- sql/migrate_payment_file_processing.sql was never applied here). The tracker
-- and the Python pipeline both insert one row per run and need MySQL to assign id.
ALTER TABLE ap_invoices_process_log MODIFY id INT NOT NULL AUTO_INCREMENT;
