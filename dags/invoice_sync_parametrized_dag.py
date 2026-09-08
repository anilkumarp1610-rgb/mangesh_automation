"""Airflow DAG: run the invoice-sync pipeline for one interface.

Interface id is read from the Airflow Variable ``invoice_sync_interface_id``
(default 1) so no code change is needed to point it at a different interface.
The pipeline itself lives in ``scripts/process_invoices.py`` -- this DAG only
puts ``scripts/`` on ``sys.path`` and calls ``main(interface_id=...)``.

Deploy this file OR ``invoice_sync_dag.py`` (not both under the same schedule
unless you intend two independent runs); they have distinct dag_ids.
"""
import logging
import os
import sys
from datetime import datetime, timedelta

from airflow import DAG
from airflow.models import Variable
from airflow.operators.python import PythonOperator

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(PROJECT_ROOT, "scripts")

if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from process_invoices import main as run_invoice_sync  # noqa: E402

log = logging.getLogger(__name__)

DEFAULT_INTERFACE_ID = 1

default_args = {
    "owner": "mangesh_automation",
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
    "depends_on_past": False,
}


def run_invoice_sync_task(**context):
    """Resolve the interface id from an Airflow Variable, then run the pipeline."""
    raw = Variable.get("invoice_sync_interface_id", default_var=str(DEFAULT_INTERFACE_ID))
    try:
        interface_id = int(raw)
    except (TypeError, ValueError):
        raise ValueError(
            f"Airflow Variable 'invoice_sync_interface_id' is not an integer: {raw!r}"
        )

    log.info("Starting invoice sync for interface_id=%s", interface_id)
    run_invoice_sync(interface_id=interface_id)
    log.info("Invoice sync finished for interface_id=%s", interface_id)


with DAG(
    dag_id="invoice_sync_parametrized_dag",
    description=(
        "Invoice-sync pipeline for the interface named by the Airflow Variable "
        "invoice_sync_interface_id (Authenticate + Get Invoice API -> MySQL -> CSV -> SFTP/email)"
    ),
    default_args=default_args,
    schedule_interval="@daily",
    start_date=datetime(2026, 8, 1),
    catchup=False,
    max_active_runs=1,
    tags=["invoice", "ap_invoices", "mysql"],
) as dag:

    PythonOperator(
        task_id="run_invoice_sync",
        python_callable=run_invoice_sync_task,
    )
