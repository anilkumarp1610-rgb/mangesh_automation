-- ============================================================================
-- Adds ap_run_log.payment_batches_response (JSON): the records the Get Payment
-- Batches API returned for the run (all pages, as one JSON array). NULL until
-- that call completes. Safe to re-run.
-- ============================================================================

USE airflow_new;

SET @db := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ap_run_log' AND COLUMN_NAME='payment_batches_response') = 0,
  'ALTER TABLE ap_run_log ADD COLUMN payment_batches_response JSON AFTER ap_batch_name',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
