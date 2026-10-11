"""Airflow DAG: ad-hoc re-run of the invoice-sync pipeline for ONE named payment batch.

Manual trigger only (``schedule=None``). The batch is pulled by its exact
``ApBatchName`` instead of a GetPaymentBatches date window -- see
``scripts/process_invoices.py::main(ap_batch_name=...)``.

Trigger with the batch name as a run param (UI: "Trigger DAG w/ config", or CLI)::

    airflow dags trigger ap_batch_adhoc_reprocess \\
        --conf '{"ap_batch_name": "Kaiser Permanente_AP_Payment_File_2026-09-01 14:43:11"}'

If no param is supplied the default below is used, so update ``DEFAULT_AP_BATCH_NAME``
(or always pass the param) before triggering. The interface id defaults to 1 and can
be overridden the same way (``"interface_id": 2``).

For the normal current-date run use ``invoice_execution_dag`` instead.
"""
import logging
import os
import sys
from datetime import datetime, timedelta

from airflow import DAG
from airflow.models.param import Param
from airflow.operators.python import PythonOperator

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(PROJECT_ROOT, "scripts")

if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from process_invoices import main as run_invoice_sync  # noqa: E402

log = logging.getLogger(__name__)

DEFAULT_INTERFACE_ID = 1
DEFAULT_AP_BATCH_NAME = "Kaiser Permanente_AP_Payment_File_2026-09-01 14:43:11"

default_args = {
    "owner": "mangesh_automation",
    "retries": 0,  # ad-hoc re-run: inspect a failure rather than auto-retrying
    "depends_on_past": False,
}


def run(interface_id, ap_batch_name, **context):
    """Run the pipeline for a single named payment batch (params are templated in)."""
    interface_id = int(interface_id)
    ap_batch_name = (ap_batch_name or "").strip()
    if not ap_batch_name:
        raise ValueError("ap_batch_name must be a non-empty ApBatchName")
    log.info("Ad-hoc reprocess: interface_id=%s ap_batch_name=%r", interface_id, ap_batch_name)
    run_invoice_sync(interface_id=interface_id, ap_batch_name=ap_batch_name)
    log.info("Ad-hoc reprocess finished: %r", ap_batch_name)


with DAG(
    dag_id="ap_batch_adhoc_reprocess",
    description="Manually re-run the invoice-sync pipeline for one named AP payment batch",
    default_args=default_args,
    schedule=None,
    start_date=datetime(2026, 8, 1),
    catchup=False,
    max_active_runs=1,
    params={
        "interface_id": Param(DEFAULT_INTERFACE_ID, type="integer"),
        "ap_batch_name": Param(DEFAULT_AP_BATCH_NAME, type="string", minLength=1),
    },
    tags=["AP", "Batch", "adhoc", "invoice"],
) as dag:

    PythonOperator(
        task_id="process_specific_ap_batch",
        python_callable=run,
        op_kwargs={
            "interface_id": "{{ params.interface_id }}",
            "ap_batch_name": "{{ params.ap_batch_name }}",
        },
    )
