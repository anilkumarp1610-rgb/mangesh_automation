import os
import sys
from datetime import datetime, timedelta

from airflow import DAG
from airflow.operators.python import PythonOperator

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(PROJECT_ROOT, "scripts")

if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from process_invoices import main as run_invoice_sync  # noqa: E402

# interfaceconfiguration.InterfaceId to process. Add another DAG (or parameterize
# this one) if more interfaces need their own schedule.
INTERFACE_ID = 1

default_args = {
    "owner": "mangesh_automation",
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
}

with DAG(
    dag_id="invoice_sync_dag",
    description=(
        "Authenticate against the Invoice API, fetch invoice details for every "
        "ap_invoices.ap_invoice_number, and sync the results back into MySQL"
    ),
    default_args=default_args,
    schedule_interval="@daily",
    start_date=datetime(2026, 8, 1),
    catchup=False,
    tags=["invoice", "ap_invoices", "mysql"],
) as dag:

    run_invoice_sync_task = PythonOperator(
        task_id="run_invoice_sync",
        python_callable=run_invoice_sync,
        op_kwargs={"interface_id": INTERFACE_ID},
    )
