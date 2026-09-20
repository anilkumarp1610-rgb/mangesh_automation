import logging

from config import LoggingConfig

LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"


def setup_logging(cfg: LoggingConfig) -> None:
    """Console-only logging (no file handler -- persistence is via
    ap_process_log, see db_log_handler.DbLogHandler, attached separately once
    the DB connection and run_log_id are available)."""
    formatter = logging.Formatter(LOG_FORMAT)
    level = getattr(logging, cfg.level.upper(), logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(level)
    root_logger.handlers.clear()

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # third-party libraries are noisy at INFO; keep the log focused on this pipeline
    logging.getLogger("mysql.connector").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
