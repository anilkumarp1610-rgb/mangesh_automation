-- ============================================================================
-- Adds every column introduced for run-log tagging and raw API response storage.
-- Re-runnable: each ALTER is guarded via information_schema, so a column /
-- index / foreign key that already exists is skipped (no "ADD COLUMN IF NOT
-- EXISTS" -- that syntax needs MySQL 8.0.29+).
--
--   ap_run_log.payment_batches_response          JSON    Get Payment Batches response records for the run
--   ap_payment_file_details.run_log_id           BIGINT  FK -> ap_run_log.id (run that pulled the batch)
--   ap_payment_file_details.invoice_list_response JSON   Get Invoice List response records for the batch
--   ap_invoices.run_log_id                       BIGINT  FK -> ap_run_log.id (run that pulled the invoice)
--
-- Run it against the pipeline database: select it first (USE <your_db>;) or
-- connect with it as the default schema. Requires ap_run_log,
-- ap_payment_file_details and ap_invoices to already exist.
-- ============================================================================

SET @db := DATABASE();

-- --- ap_run_log.payment_batches_response -----------------------------------
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ap_run_log' AND COLUMN_NAME='payment_batches_response') = 0,
  'ALTER TABLE ap_run_log ADD COLUMN payment_batches_response JSON NULL AFTER ap_batch_name',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- --- ap_payment_file_details.run_log_id (+ FK) ------------------------------
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ap_payment_file_details' AND COLUMN_NAME='run_log_id') = 0,
  'ALTER TABLE ap_payment_file_details ADD COLUMN run_log_id BIGINT NULL',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ap_payment_file_details'
       AND CONSTRAINT_NAME='fk_payment_file_run_log') = 0,
  'ALTER TABLE ap_payment_file_details ADD CONSTRAINT fk_payment_file_run_log '
  'FOREIGN KEY (run_log_id) REFERENCES ap_run_log (id)',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- --- ap_payment_file_details.invoice_list_response --------------------------
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ap_payment_file_details' AND COLUMN_NAME='invoice_list_response') = 0,
  'ALTER TABLE ap_payment_file_details ADD COLUMN invoice_list_response JSON NULL',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- --- ap_invoices.run_log_id (+ index, FK) -----------------------------------
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ap_invoices' AND COLUMN_NAME='run_log_id') = 0,
  'ALTER TABLE ap_invoices ADD COLUMN run_log_id BIGINT NULL',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ap_invoices' AND INDEX_NAME='ix_ap_invoices_run_log_id') = 0,
  'ALTER TABLE ap_invoices ADD KEY ix_ap_invoices_run_log_id (run_log_id)',
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
