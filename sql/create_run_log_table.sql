-- ============================================================================
-- Standalone DDL for the run-log feature (scripts/repository.py::insert_run_log,
-- called from process_invoices.py::main() at the start of every run) that a
-- pre-existing database won't have yet:
--   ap_run_log                    <- new table, one row per process_invoices.py run
--   ap_payment_file_details       <- gains run_log_id (FK -> ap_run_log.id)
--
-- Safe to run against an existing database, and safe to re-run: CREATE TABLE
-- IF NOT EXISTS works on every MySQL/MariaDB version; the ADD COLUMN / ADD
-- CONSTRAINT below are guarded via information_schema + dynamic SQL instead of
-- "ADD COLUMN IF NOT EXISTS" (that syntax needs MySQL 8.0.29+, which not every
-- environment has -- see the ap_batch_invoice_details migration for the same
-- pattern).
--
-- Requires ap_payment_file_details to already exist (see sql/create_tables.sql
-- / sql/create_batch_detail_tables.sql).
-- ============================================================================

USE airflow_new;

-- One row per process_invoices.py invocation -- see the column comments in
-- sql/create_tables.sql for the full rationale.
CREATE TABLE IF NOT EXISTS ap_run_log (
    id                          BIGINT AUTO_INCREMENT PRIMARY KEY,
    interface_id                INT NOT NULL,
    from_date                   DATETIME,
    to_date                     DATETIME,
    ap_batch_name               VARCHAR(200),
    started_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_run_log_interface_id (interface_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @db := DATABASE();

-- ap_payment_file_details.run_log_id
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ap_payment_file_details' AND COLUMN_NAME='run_log_id') = 0,
  'ALTER TABLE ap_payment_file_details ADD COLUMN run_log_id BIGINT',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- fk_payment_file_run_log (guarded the same way -- MySQL has no "ADD CONSTRAINT
-- IF NOT EXISTS" on any version)
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ap_payment_file_details'
       AND CONSTRAINT_NAME='fk_payment_file_run_log') = 0,
  'ALTER TABLE ap_payment_file_details ADD CONSTRAINT fk_payment_file_run_log '
  'FOREIGN KEY (run_log_id) REFERENCES ap_run_log (id)',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
