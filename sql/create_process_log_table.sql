-- ============================================================================
-- Standalone DDL for the DB-backed process-logging feature
-- (scripts/db_log_handler.py::DbLogHandler, attached to the root logger from
-- process_invoices.py::main() once run_log_id is known) that a pre-existing
-- database won't have yet:
--   ap_process_log   <- new table, one row per log record emitted anywhere in
--                        the pipeline during a run (replaces the old file-based
--                        logging entirely -- console output is still live, but
--                        nothing is written to logs/*.log any more)
--
-- Safe to run against an existing database, and safe to re-run: CREATE TABLE
-- IF NOT EXISTS works on every MySQL/MariaDB version.
--
-- Requires ap_run_log to already exist (see sql/create_run_log_table.sql).
--
-- NOTE: ap_payment_file_detail_id deliberately has NO foreign key. DbLogHandler
-- writes from its own separate, autocommit connection, while the batch's
-- ap_payment_file_details row is inserted (uncommitted) on the main
-- connection/transaction inside sync_payment_files() -- which doesn't commit
-- until that whole function returns. An FK here would force every log insert
-- tagged with that batch to wait on the uncommitted parent row's lock for the
-- full innodb_lock_wait_timeout (default 50s) before failing, once per log
-- line, for the entire duration of that batch's processing. run_log_id keeps
-- its FK since ap_run_log is always committed (on its own, immediately) before
-- DbLogHandler is even attached -- no cross-connection wait there.
-- ============================================================================

USE airflow_new;

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
