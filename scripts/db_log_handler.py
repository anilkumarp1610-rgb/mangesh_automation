import logging

import mysql.connector

from config import MySqlConfig
from log_context import current_payment_file_detail_id


class DbLogHandler(logging.Handler):
    """Mirrors every log record emitted anywhere in the pipeline into
    ap_process_log, tagged with this run (run_log_id) and, when emitted from
    inside a batch's processing block, that batch's ap_payment_file_detail_id
    (see log_context.py -- set/reset around the relevant blocks in
    sync_payment_files.py and process_invoices.py, NULL otherwise).

    Uses its own dedicated, autocommit connection -- separate from the main
    business-transaction cursor -- so log rows (especially ERROR ones) persist
    even if the run they describe later rolls back. emit() never raises: a
    logging failure must not break the pipeline it's logging."""

    def __init__(self, mysql_cfg: MySqlConfig, run_log_id: int):
        super().__init__()
        self.run_log_id = run_log_id
        self._conn = mysql.connector.connect(
            host=mysql_cfg.host,
            user=mysql_cfg.user,
            password=mysql_cfg.password,
            database=mysql_cfg.database,
            autocommit=True,
        )

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = self.format(record)
            cursor = self._conn.cursor()
            try:
                cursor.execute(
                    "INSERT INTO ap_process_log "
                    "(run_log_id, ap_payment_file_detail_id, log_level, logger_name, message) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (
                        self.run_log_id,
                        current_payment_file_detail_id.get(),
                        record.levelname,
                        record.name,
                        message,
                    ),
                )
            finally:
                cursor.close()
        except Exception:
            self.handleError(record)

    def close(self) -> None:
        try:
            self._conn.close()
        finally:
            super().close()
