-- ============================================================================
-- Adds ap_invoices.run_log_id (FK -> ap_run_log.id) so each invoice row records
-- the run that pulled it; update_ap_invoice_status scopes its UPDATE to
-- ap_invoice_id + ap_paymentfile_id + run_log_id.
-- Requires ap_run_log (see apply_logging_changes.sql). Safe to re-run.
-- Existing rows get NULL run_log_id (fine: tables are truncated before testing;
-- otherwise backfill from ap_payment_file_details, see the UPDATE below).
-- ============================================================================

USE airflow_new;

SET @db := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ap_invoices' AND COLUMN_NAME='run_log_id') = 0,
  'ALTER TABLE ap_invoices ADD COLUMN run_log_id BIGINT, ADD KEY ix_ap_invoices_run_log_id (run_log_id)',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ap_invoices'
       AND CONSTRAINT_NAME='fk_ap_invoices_run_log') = 0,
  'ALTER TABLE ap_invoices ADD CONSTRAINT fk_ap_invoices_run_log '
  'FOREIGN KEY (run_log_id) REFERENCES ap_run_log (id)',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Optional backfill for rows that already exist:
-- UPDATE ap_invoices i JOIN ap_payment_file_details p ON p.id = i.ap_paymentfile_id
--    SET i.run_log_id = p.run_log_id WHERE i.run_log_id IS NULL;
