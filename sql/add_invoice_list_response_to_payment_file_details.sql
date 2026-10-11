-- ============================================================================
-- Adds ap_payment_file_details.invoice_list_response (JSON): the records the
-- Get Invoice List API returned for the payment file (all pages, one JSON
-- array). NULL until that call completes. Safe to re-run.
-- ============================================================================

USE airflow_new;

SET @db := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ap_payment_file_details' AND COLUMN_NAME='invoice_list_response') = 0,
  'ALTER TABLE ap_payment_file_details ADD COLUMN invoice_list_response JSON AFTER fetched_datetime',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
