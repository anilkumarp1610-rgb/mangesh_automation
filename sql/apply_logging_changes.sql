-- ============================================================================
-- Combined ALTER/migration script for the two features added this session:
--   1. ap_run_log                    <- new table, one row per process_invoices.py run
--   2. ap_payment_file_details       <- gains run_log_id (FK -> ap_run_log.id)
--   3. ap_process_log                <- new table, one row per log record (replaces
--                                        file-based logging entirely)
--
-- Equivalent to running sql/create_run_log_table.sql then
-- sql/create_process_log_table.sql, combined here for convenience. Safe to
-- run against an existing database, and safe to re-run:
--   - CREATE TABLE IF NOT EXISTS works on every MySQL/MariaDB version.
--   - The ADD COLUMN / ADD CONSTRAINT below are guarded via information_schema
--     + dynamic SQL instead of "ADD COLUMN IF NOT EXISTS" (that syntax needs
--     MySQL 8.0.29+, which not every environment has).
--
-- Requires ap_payment_file_details to already exist.
-- ============================================================================

USE airflow_new;

-- --- 1. ap_run_log --------------------------------------------------------
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

-- --- 2. ap_payment_file_details.run_log_id + FK ----------------------------
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ap_payment_file_details' AND COLUMN_NAME='run_log_id') = 0,
  'ALTER TABLE ap_payment_file_details ADD COLUMN run_log_id BIGINT',
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

-- --- 3. ap_process_log ------------------------------------------------------
-- NOTE: ap_payment_file_detail_id deliberately has NO foreign key. DbLogHandler
-- writes from its own separate, autocommit connection, while the batch's
-- ap_payment_file_details row sits uncommitted on the main transaction for the
-- whole duration of sync_payment_files(). An FK here forces every log insert
-- tagged with that batch to wait on the uncommitted parent row's lock for the
-- full innodb_lock_wait_timeout (default 50s) before failing -- once per log
-- line -- which is exactly the ~50s-per-line stall this script fixes.
CREATE TABLE IF NOT EXISTS ap_process_log (
    id                          BIGINT AUTO_INCREMENT PRIMARY KEY,
    run_log_id                  BIGINT NOT NULL,
    ap_payment_file_detail_id   INT,
    log_level                   VARCHAR(10) NOT NULL,
    logger_name                 VARCHAR(100),
    message                     TEXT NOT NULL,
    created_datetime            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY ix_process_log_run_log_id (run_log_id),
    KEY ix_process_log_payment_file_detail_id (ap_payment_file_detail_id),
    CONSTRAINT fk_process_log_run_log FOREIGN KEY (run_log_id)
        REFERENCES ap_run_log (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Drops the bad FK if this script (or an earlier version of it) already
-- created ap_process_log with it -- safe/idempotent to re-run.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ap_process_log'
       AND CONSTRAINT_NAME='fk_process_log_payment_file') > 0,
  'ALTER TABLE ap_process_log DROP FOREIGN KEY fk_process_log_payment_file',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
