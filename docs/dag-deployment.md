# Invoice Sync DAG — Deployment Runbook

Audience: deployment / infrastructure team.
Scope: deploy and run `dags/invoice_sync_dag.py` on an Apache Airflow instance.

The DAG runs the same pipeline as `python scripts/process_invoices.py --interface-id <id>`.
It does **not** shell out — it imports `process_invoices.main` and calls
`main(interface_id=INTERFACE_ID)` from a single `PythonOperator` task.

---

## 0. TL;DR checklist

| # | Step | Command / file |
|---|---|---|
| 1 | Put the **whole repo** on the Airflow host (not just the DAG file) | `git clone` / release tarball |
| 2 | Install Python deps into the Airflow environment | `pip install -r requirements.txt` |
| 3 | Create the DB schema **from `sql/create_tables.sql`** | see §3 |
| 4 | Point `config/appsettings.yml` → `MySql` at that database | see §4 |
| 5 | Insert / verify the `interfaceconfiguration` row | see §5 |
| 6 | Seed `ap_payment_file_details` (`ap_batch_status='New'`) + `ap_invoices` | see §5 |
| 7 | Make the DAG discoverable (`dags_folder`) | see §6 |
| 8 | Set `INTERFACE_ID` in `dags/invoice_sync_dag.py` | see §6 |
| 9 | Unpause + trigger, watch the task log | see §7 |
| 10 | Verify DB writes + CSV + SFTP + email | see §8 |

> **Most common deployment failure:** creating the schema from the ad-hoc file
> `My SQL table Creation Script Air flow updated.txt` instead of
> `sql/create_tables.sql`. That ad-hoc file has several column-name / column-type
> defects (`interfaceid` vs `interface_id`, non-auto-increment PKs, undersized
> `api_response_obj`, missing `invoice_summary.ap_payment_file_detail_id`).
> **Use `sql/create_tables.sql`.** See §9 for the exact errors each defect produces.

---

## 1. What the DAG does

```
invoice_sync_dag  (schedule: @daily, catchup: False, retries: 1 @ 5 min)
└── run_invoice_sync   PythonOperator
       → process_invoices.main(interface_id=INTERFACE_ID)
            1. load interfaceconfiguration row for InterfaceId
            2. authenticate against the interface's Invoice API
            3. find ap_payment_file_details rows: interface_id = ?, ap_batch_status = 'New'
            4. for each such payment file:
                 - pull its ap_invoices numbers
                 - create ap_invoices_process_log row (new UUID)
                 - for each invoice: Get Invoice API → invoice_response_log
                   → update ap_invoices → (on SUCCESS) invoice_summary/detail/…
                 - build run-scoped CSV → upload to SFTP → success/failure email
                 - set ap_batch_status = 'Success' / 'Failure'
```

Full architecture and table reference: [`README.md`](../README.md) §1–§6.

---

## 2. Prerequisites

| Requirement | Notes |
|---|---|
| Apache Airflow | Any 2.x. `apache-airflow` is intentionally **not** in `requirements.txt`. |
| Python | 3.12+ in the Airflow worker/scheduler environment. |
| MySQL Server | Reachable from the Airflow host. Version 5.7+ / 8.x. |
| Network egress from the Airflow worker | Invoice API `BaseUri`, SFTP host, SMTP host. |
| Repo layout preserved | Scripts read `config/*.yml` via a path relative to the repo root (`<repo>/config`). The `dags/`, `scripts/`, `config/` folders must stay together. |

---

## 3. Database schema

Run **once** against the target database.

### Fresh database
```bash
mysql -h <db-host> -u <user> -p < sql/create_tables.sql
```
`sql/create_tables.sql` starts with `USE airflow;`. If your database is **not**
named `airflow`, either:
- create it as `airflow`, **or**
- edit the `USE ...;` line (and the `USE airflow;` in
  `sql/migrate_payment_file_processing.sql`) to your database name before running.

`create_tables.sql` uses `CREATE TABLE IF NOT EXISTS` and also inserts seed rows
for `interfaceconfiguration` (CBTS_AP), `ap_payment_file_details`, and
`ap_invoices` — review/adjust those seed values for the target environment.

### Database that already had the older tables
If `interfaceconfiguration`, `ap_payment_file_details`, `ap_invoices_process_log`,
`invoice_summary` already exist in a pre-payment-file-tracking shape, the
`IF NOT EXISTS` statements are no-ops — run the catch-up migration instead:
```bash
mysql -h <db-host> -u <user> -p < sql/migrate_payment_file_processing.sql
```

### Do NOT use
`My SQL table Creation Script Air flow updated.txt` in the repo root is an ad-hoc
export and is **not** the source of truth. See §9.

---

## 4. `config/appsettings.yml`

Only the `MySql` block is environment-specific for deployment. Everything under
`Sftp` / `Email` / `InvoiceApi.Authentication` is sourced per-interface from the
`interfaceconfiguration` table (§5); the YAML only holds fallbacks.

```yaml
MySql:
  Host: <db-host>          # e.g. 10.x.x.x  (NOT localhost, unless MySQL is on the Airflow host)
  User: <db-user>
  Password: <db-password>
  Database: <db-name>      # must match the schema you created in §3
```

Notes:
- The `MySql` block is **not** `${ENV_VAR}`-expanded (only `Sftp`/`Email` are).
  Put literal values here, or manage this file with your config tooling.
- `Logging.Folder` and `Output.Folder` may be relative (resolved against the repo
  root) or absolute. On Airflow, prefer **absolute** paths the worker can write
  to, e.g. `/opt/airflow/invoice-sync/logs` and `/opt/airflow/invoice-sync/output`.
- Passwords containing `@` are handled by `mysql.connector`; no encoding needed
  in this file.

---

## 5. `interfaceconfiguration` + source data

### 5.1 Interface row
There must be exactly one **active** row for the `InterfaceId` the DAG runs:
```sql
SELECT InterfaceId, InterfaceName, IsActive,
       Platform_InstanceUrl, Platform_UserId, Platform_AppAuthKey,
       SFTP_Host, SMTP_Host, Email_Recipients_To
FROM interfaceconfiguration
WHERE InterfaceId = 1;      -- must return 1 row with IsActive = 1
```
Populate at minimum, for that row:
- `Platform_InstanceUrl` — Invoice API base URI
- `Platform_UserId`, `Platform_Password`, `Platform_AppAuthKey` — Invoice API auth
- `SFTP_Host`, `SFTP_Port`, `SFTP_UserName`, `SFTP_Password`, `SFTP_RemoteDirectory`
- `SMTP_Host`, `SMTP_Port`, `SMTP_UserId`, `SMTP_Password`, `SMTP_UseTLS`
- `Email_Enabled`, `Email_Sender_Email`, `Email_Recipients_To`, `Email_Subject`, `Email_Body`
- `Failure_Notification_Enabled`, `Failure_Subject`, `Failure_Body`, `Failure_Recipients_To`

Any column left `NULL` falls back to `config/appsettings.yml`. Full column→config
mapping: [`README.md`](../README.md) §4.

> Secret columns are **plaintext** today. Restrict access to this table.

### 5.2 Work to process
The DAG only does something if there is open work for the interface:
```sql
-- at least one 'New' batch for this interface
SELECT id, ap_batch_name, interface_id, ap_batch_status
FROM ap_payment_file_details
WHERE interface_id = 1 AND ap_batch_status = 'New';

-- invoices linked to that batch id
SELECT ap_invoice_number, ap_paymentfile_id
FROM ap_invoices
WHERE ap_paymentfile_id = <id from previous query>;
```
If there are no `'New'` rows the task **succeeds** and logs
`found 0 open ('New') payment file(s)` — that is not an error.

---

## 6. Install the DAG

### 6.1 Make it discoverable
Pick one:
- **Symlink** the repo's `dags/` into Airflow's `dags_folder`:
  ```bash
  ln -s /opt/airflow/invoice-sync/dags/invoice_sync_dag.py \
        $AIRFLOW_HOME/dags/invoice_sync_dag.py
  ```
- **Or** set `AIRFLOW__CORE__DAGS_FOLDER=/opt/airflow/invoice-sync/dags`.
- **Or** copy `invoice_sync_dag.py` into `dags_folder` — but the repo's
  `scripts/` and `config/` must still be present two levels up from the DAG file
  (`PROJECT_ROOT = dirname(dirname(dag_file))`), so a bare copy will break the
  imports. Symlink or `DAGS_FOLDER` is safer.

The DAG file inserts `<repo>/scripts` onto `sys.path` at import time, so the
scheduler's Python must be able to `import process_invoices` and its
dependencies (§2, §7.1).

### 6.2 Set the interface id
`dags/invoice_sync_dag.py`:
```python
INTERFACE_ID = 1   # interfaceconfiguration.InterfaceId this DAG processes
```
For a second interface, copy the DAG to a new file with a new `dag_id` and
`INTERFACE_ID`, or parameterize via an Airflow Variable:
```python
from airflow.models import Variable
INTERFACE_ID = int(Variable.get("invoice_sync_interface_id", default_var=1))
```

### 6.3 Schedule / behavior (as shipped)
| Setting | Value | Change it in |
|---|---|---|
| `schedule_interval` | `@daily` | `invoice_sync_dag.py` |
| `catchup` | `False` (no backfill on deploy) | `invoice_sync_dag.py` |
| `start_date` | `2026-08-01` | `invoice_sync_dag.py` |
| `retries` | `1`, `retry_delay` 5 min | `default_args` |
| `owner` | `mangesh_automation` | `default_args` |

---

## 7. First run / smoke test

### 7.1 Verify imports on the Airflow host first
```bash
cd /opt/airflow/invoice-sync
python -c "import mysql.connector, requests, yaml, paramiko, pandas, sqlalchemy; print('deps ok')"
python -c "import sys; sys.path.insert(0,'scripts'); import process_invoices; print('import ok')"
```
Run these as the **airflow** user, in the **same environment** the scheduler/worker uses.

### 7.2 Check DAG parsing
```bash
airflow dags list | grep invoice_sync_dag
airflow dags list-import-errors
```

### 7.3 Trigger
```bash
airflow dags unpause invoice_sync_dag
airflow dags trigger  invoice_sync_dag
```
Or run the task synchronously for a clean log:
```bash
airflow tasks test invoice_sync_dag run_invoice_sync 2026-09-08
```

### 7.4 Read the log
The task log (Airflow UI → the task → Logs) contains the pipeline output. The
same lines are also written to
`<Logging.Folder>/process_invoices_<YYYYMMDD_HHMMSS>.log`.

Healthy run markers:
```
=== process_invoices run starting for InterfaceId=1 ===
Step 1-2: interface configuration loaded
Authentication successful
Step 3: found N open ('New') payment file(s) for InterfaceId=1
=== Payment file <name> (id=...): starting ===
Invoice <num> -- HTTP 200 ...
Payment file <name>: Step 6 complete -- X SUCCESS, Y PENDING, Z FAILED
delivery: Email sent: subject=...
=== process_invoices run finished for InterfaceId=1 ===
```

---

## 8. Post-run verification

```sql
-- API outcome written back per invoice
SELECT ap_invoice_number, ap_invoice_api_status, api_response_status_code
FROM ap_invoices WHERE ap_paymentfile_id = <batch id>;

-- one run row, with a UUID
SELECT id, proces_datetime, invoice_process_uuid, ap_payment_file_detail_id
FROM ap_invoices_process_log ORDER BY id DESC LIMIT 5;

-- batch closed out
SELECT id, ap_batch_status, processed_date, log_id
FROM ap_payment_file_details WHERE interface_id = 1;

-- detail rows for successful invoices
SELECT COUNT(*) FROM invoice_summary WHERE invoice_process_uuid = '<uuid from above>';
```
Also confirm:
- CSV written to `<Output.Folder>/` (name is `<InterfaceName>_invoices_export_<batch>_<ddMMyyyy_hhmmss>.csv`)
- File landed on the SFTP `RemoteDirectory`
- Success or failure email received by `Email_Recipients_To`

### Re-running a failed batch
A batch marked `Failure` is **not** retried automatically. To reprocess:
```sql
UPDATE ap_payment_file_details
SET ap_batch_status = 'New', processed_date = NULL, log_id = NULL
WHERE id = <batch id>;
```
Then trigger the DAG again (or wait for the next `@daily` run).

---

## 9. Troubleshooting

| Symptom in task log | Cause | Fix |
|---|---|---|
| `the following arguments are required: --interface-id` | Ran `process_invoices.py` by hand without the flag. The DAG is unaffected (it passes `interface_id=` as a kwarg). | CLI only: `python scripts/process_invoices.py --interface-id 1` |
| `1054 (42S22): Unknown column 'interface_id' in 'field list'` | Schema built from the ad-hoc file — its `ap_payment_file_details` column is `interfaceid`. | Rebuild from `sql/create_tables.sql`, **or** `ALTER TABLE ap_payment_file_details CHANGE COLUMN interfaceid interface_id INT NULL;` |
| `1364 (HY000): Field 'id' doesn't have a default value` | Ad-hoc file's `ap_invoices_process_log.id` lacks `AUTO_INCREMENT`. | `ALTER TABLE ap_invoices_process_log MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT;` (or use `create_tables.sql` / `migrate_payment_file_processing.sql`) |
| `1054 (42S22): Unknown column 'ap_payment_file_detail_id'` (insert into `invoice_summary`) | Ad-hoc file's `invoice_summary` is missing that column. | `ALTER TABLE invoice_summary ADD COLUMN ap_payment_file_detail_id INT NULL AFTER invoice_process_uuid;` |
| `1049 Unknown database 'airflow'` / `1146 Table 'airflow.ap_invoices' doesn't exist` | `scripts/repository.py::update_ap_invoice_status` had a hardcoded `airflow.` schema prefix. | Fixed in code (now `UPDATE ap_invoices`). Ensure you deploy the current `scripts/` and that `MySql.Database` matches your DB. |
| `ap_invoices` status columns never update, but no error | Same hardcoded prefix wrote to a *different* schema named `airflow` that happened to exist. | Same as above — deploy current `scripts/`. Check old data with `SELECT * FROM airflow.ap_invoices;` |
| `1406 (22001): Data too long for column 'api_response_obj'` | Ad-hoc file typed it `varchar(12000)`; real API responses are larger. `create_tables.sql` uses `JSON`. | `ALTER TABLE ap_invoices MODIFY COLUMN api_response_obj LONGTEXT NULL;` |
| `1406 Data too long for column '<reason/address/…>'` | Live API returned a value longer than the DDL `VARCHAR`. | `ALTER TABLE <table> MODIFY COLUMN <col> TEXT;` |
| Task succeeds, `found 0 open ('New') payment file(s)` | No work queued for this interface. | Insert/flip an `ap_payment_file_details` row to `ap_batch_status='New'` for `interface_id = INTERFACE_ID`. |
| `RuntimeError` about missing `client_api_key` / `login_user_name` / `password` | Invoice API auth not set for this interface and no YAML fallback. | Populate `Platform_UserId` / `Platform_Password` / `Platform_AppAuthKey` on the `interfaceconfiguration` row. |
| `RuntimeError` from `upload_to_sftp` about blank host / unexpanded `${...}` | SFTP not configured for this interface. | Populate `SFTP_*` columns, or the `Sftp` block in `appsettings.yml`. |
| DAG not in the UI / `list-import-errors` shows `ModuleNotFoundError: process_invoices` | DAG file copied out of the repo, or Airflow env missing deps. | Symlink the repo `dags/` or set `DAGS_FOLDER`; `pip install -r requirements.txt` into the Airflow env. |

---

## 10. Rollback

The DAG is additive — it reads config/source tables and writes results.

- **Disable:** `airflow dags pause invoice_sync_dag` (or remove the DAG file / symlink).
- **Undo a bad run's batch status:** see §8 "Re-running a failed batch".
- **Schema:** the `ALTER`/`CREATE` in §3 are forward-only. There is no destructive
  drop in the deploy path; a rollback of schema changes would be a manual
  `ALTER ... DROP COLUMN` and is not expected.
- The pipeline never deletes `ap_invoices` / `ap_payment_file_details` rows; it
  only updates status columns and inserts into the `invoice_*` detail tables.

---

## Appendix A — DAG script

### A.1 As shipped: `dags/invoice_sync_dag.py`

This is the file currently in the repo. Single interface, hardcoded `INTERFACE_ID`.

```python
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
```

### A.2 Optional: parameterized variant `dags/invoice_sync_parametrized_dag.py`

Same pipeline, but the interface id comes from an Airflow **Variable**
(`invoice_sync_interface_id`, default `1`) instead of a code edit, and the task
is wrapped so the interface id and outcome show up clearly in the task log.
Drop this file in `dags/` **instead of or alongside** A.1 (give it a distinct
`dag_id`). Set the Variable with:

```bash
airflow variables set invoice_sync_interface_id 1
```

```python
"""Airflow DAG: run the invoice-sync pipeline for one interface.

Interface id is read from the Airflow Variable ``invoice_sync_interface_id``
(default 1) so no code change is needed to point it at a different interface.
The pipeline itself lives in ``scripts/process_invoices.py`` -- this DAG only
puts ``scripts/`` on ``sys.path`` and calls ``main(interface_id=...)``.
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
    """Resolve the interface id, then run the pipeline for it."""
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
```

### A.3 Optional: BashOperator variant (true subprocess / CLI path)

Use this if you want the script to run in its own process (e.g. a dedicated
virtualenv) and go through the `--interface-id` argparse path rather than the
in-process call. Replace the path with your deployed location.

```python
import os
from datetime import datetime, timedelta

from airflow import DAG
from airflow.operators.bash import BashOperator

PROJECT_ROOT = "/opt/airflow/invoice-sync"          # deployed repo root
PYTHON_BIN = "/opt/airflow/invoice-sync/.venv/bin/python"  # or just "python"
INTERFACE_ID = 1

default_args = {
    "owner": "mangesh_automation",
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
}

with DAG(
    dag_id="invoice_sync_bash_dag",
    default_args=default_args,
    schedule_interval="@daily",
    start_date=datetime(2026, 8, 1),
    catchup=False,
    tags=["invoice", "ap_invoices", "mysql"],
) as dag:

    BashOperator(
        task_id="run_invoice_sync",
        bash_command=(
            f"cd {PROJECT_ROOT}/scripts && "
            f"{PYTHON_BIN} process_invoices.py --interface-id {INTERFACE_ID}"
        ),
    )
```

> Only deploy **one** of these DAG files per interface unless each has a distinct
> `dag_id` and you intend them to run independently.
