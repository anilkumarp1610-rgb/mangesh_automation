import logging
import os
from datetime import datetime

from config import LoggingConfig

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def setup_logging(cfg: LoggingConfig, run_name: str = "process_invoices") -> str:
    folder = cfg.folder
    if not os.path.isabs(folder):
        folder = os.path.join(PROJECT_ROOT, folder)
    os.makedirs(folder, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = os.path.join(folder, f"{run_name}_{timestamp}.log")

    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )
    level = getattr(logging, cfg.level.upper(), logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(level)
    root_logger.handlers.clear()

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # third-party libraries are noisy at INFO; keep the log focused on this pipeline
    logging.getLogger("mysql.connector").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    return log_file
