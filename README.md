# Mangesh Automation — Invoice Sync Pipeline

Pulls invoice numbers from the local `airflow.ap_invoices` MySQL table, authenticates
against an internal Invoice API, fetches full invoice detail for each invoice number,
writes the outcome back onto `ap_invoices`, and stores the full nested API response
(summary → detail → line items → services → charges) into normalized tables for
downstream reporting/auditing.

## 1. Architecture / Process Flow

```
                 ┌─────────────────────┐
                 │  airflow.ap_invoices │  (source list of invoice numbers)
                 └──────────┬───────────┘
                            ▼
        ┌────────────────────────────────────────────────────┐
        │ Step 1: Authenticate  (auth_client.py)                │
        │   POST {BaseUri}/api/v2/Authenticate -> Bearer token    │
        └──────────┬───────────────────────────────────────────┘
                    ▼
        ┌────────────────────────────────────────────────────┐
        │ Step 2: Get invoice numbers  (process_invoices.py)     │
        │   SELECT DISTINCT ap_invoice_number FROM ap_invoices     │
        └──────────┬───────────────────────────────────────────┘
                    ▼
        ┌── for each invoice_number ─────────────────────────────────────┐
        │  Step 3: Get Invoice data  (invoice_client.py)                    │
        │    GET {BaseUri}/api/v2/invoices?invoiceNumber=...                  │
        │    -> raw response logged to invoice_response_log                     │
        │                                                                          │
        │  Step 4: Update ap_invoices  (repository.py)                             │
        │    SET ap_invoice_api_status, api_response_obj,                            │
        │        api_response_status_code                                             │
        │    (only when status = SUCCESS) also persists the nested payload:            │
        │    invoice_summary -> invoice_detail -> invoice_line_detail                    │
        │      -> invoice_service -> invoice_charge                                        │
        └──────────┬───────────────────────────────────────────────────────────────────────┘
                    ▼ (after every invoice_number has been processed)
        ┌────────────────────────────────────────────────────┐
        │ Step 5: Generate output CSV  (export_invoices_csv.py)  │
        │   joins invoice_summary/detail/line_detail/service/       │
        │   charge into one denormalized CSV; file name = Output.      │
        │   FileName + ddMMyyyy_hhmmss timestamp (see §4)                │
        └──────────┬───────────────────────────────────────────────────┘
                    ▼
        ┌────────────────────────────────────────────────────┐
        │ Step 6: Upload to SFTP  (delivery.py::upload_to_sftp)  │
        │   puts the CSV onto Sftp.RemoteDirectory; logs outcome    │
        └──────────┬───────────────────────────────────────────────┘
                    ▼
        ┌────────────────────────────────────────────────────┐
        │ Step 7: Send email  (delivery.py::send_success_email)  │
        │   Email.* template, CSV attached; logs outcome. On any    │
        │   failure in Step 5/6/7, send_failure_email() fires instead │
        └────────────────────────────────────────────────────┘
```

## 1a. Folder Structure

```
mangesh_automation/
├── config/
│   ├── appsettings.yml       MySQL + Invoice API configuration
│   └── field_maps.yml        API field -> DB column mappings
├── scripts/
│   ├── config.py              loads appsettings.yml
│   ├── logging_config.py      per-run file + console logging setup
│   ├── field_maps.py          loads field_maps.yml
│   ├── db.py                  MySQL connection helper
│   ├── auth_client.py         Step 1: Authenticate API client
│   ├── invoice_client.py      Step 2: Get Invoice API client
│   ├── repository.py          all DB write functions
│   ├── process_invoices.py    main orchestrator (entry point)
│   ├── fetch_ap_invoices.py   standalone ap_invoices reader
│   ├── export_invoices_csv.py joins all invoice tables into one timestamped CSV
│   └── delivery.py            Steps 6-7: SFTP upload + success/failure email
├── dags/
│   └── invoice_sync_dag.py    Airflow DAG that runs process_invoices.main()
├── sql/
│   ├── create_tables.sql              full DDL for all 7 tables + seed data
│   └── create_invoice_response_log.sql standalone DDL for the log table
├── output/                    generated CSV export lands here (see Output config)
├── logs/                      one timestamped log file per process_invoices.py run
├── requirements.txt
└── README.md
```

## 2. Database Schema

Defined in [`sql/create_tables.sql`](sql/create_tables.sql) (all statements use
`CREATE TABLE IF NOT EXISTS`, safe to re-run). A standalone copy of just the log
table lives in [`sql/create_invoice_response_log.sql`](sql/create_invoice_response_log.sql).

| Table | Purpose | Key relationship |
|---|---|---|
| `ap_invoices` | Source list of invoices to process; also stores the last API call outcome | — |
| `invoice_response_log` | One row per Get Invoice API call: raw JSON response, HTTP status, timestamp | root of the chain |
| `invoice_summary` | Short `records[]` shape from the API | `invoice_id` (unique) · `log_id` → `invoice_response_log` |
| `invoice_detail` | Full `records[]` shape (all ~77 fields, when `expand=true`) | `invoice_id` (unique) → `invoice_summary` · `log_id` → `invoice_response_log` |
| `invoice_line_detail` | `invoiceDetails[]` wrapper (`serviceTotalCount`) | `detail_id` → `invoice_detail` (cascade delete) |
| `invoice_service` | `invoiceServices[]` | `line_detail_id` → `invoice_line_detail` (cascade delete) |
| `invoice_charge` | `invoiceCharges[]` | `service_pk` → `invoice_service` (cascade delete) |

**Idempotency**: `invoice_summary` / `invoice_detail` are upserted on `invoice_id`
(`ON DUPLICATE KEY UPDATE`). Nested rows (`invoice_line_detail` → `invoice_service` →
`invoice_charge`) are deleted and re-inserted per `detail_id` on every run, so
re-processing the same invoice never creates duplicate line items.

## 3. Project Files

| File | Role |
|---|---|
| `config/appsettings.yml` | All configuration — MySQL connection, API base URI, Authentication section, GetInvoice section, output/job naming, SFTP, and email templates |
| `config/field_maps.yml` | API field (camelCase) → DB column (snake_case) mappings for Summary / Detail / Service / Charge |
| `scripts/config.py` | Loads `config/appsettings.yml` into typed dataclasses (`AppConfig`, `MySqlConfig`, `InvoiceApiConfig`, `AuthenticationConfig`, `GetInvoiceConfig`, `LoggingConfig`, `JobConfig`, `SftpConfig`, `EmailConfig`) |
| `scripts/logging_config.py` | `setup_logging(cfg)` — configures one timestamped log file per run plus console output |
| `scripts/field_maps.py` | Loads `config/field_maps.yml`, exposes `SUMMARY_FIELD_MAP` / `DETAIL_FIELD_MAP` / `SERVICE_FIELD_MAP` / `CHARGE_FIELD_MAP` and `map_record()` |
| `scripts/db.py` | `get_connection(cfg)` — raw `mysql.connector` connection (used for transactional multi-table writes) |
| `scripts/auth_client.py` | `authenticate(cfg)` — Step 1, calls the Authenticate API, returns the bearer token |
| `scripts/invoice_client.py` | `get_invoice(cfg, token, invoice_number)` — Step 2, calls the Get Invoice API |
| `scripts/repository.py` | All DB write functions (see §5) |
| `scripts/process_invoices.py` | Main orchestrator — entry point for the full pipeline |
| `scripts/fetch_ap_invoices.py` | Standalone helper — reads `ap_invoices` into a pandas DataFrame (ad hoc use / debugging) |
| `scripts/export_invoices_csv.py` | Joins `invoice_summary` → `invoice_detail` → `invoice_line_detail` → `invoice_service` → `invoice_charge` and writes one combined, timestamped CSV to the configured output folder |
| `scripts/delivery.py` | Step 6: `upload_to_sftp()` puts the CSV on the SFTP server; Step 7: `send_success_email()` / `send_failure_email()` send the configured email template with the CSV attached. Both log their outcome. |
| `dags/invoice_sync_dag.py` | Airflow DAG — schedules `scripts/process_invoices.py:main()` as a `PythonOperator` task |
| `sql/create_tables.sql` | Full DDL for all 7 tables + seed rows for `ap_invoices` |
| `sql/create_invoice_response_log.sql` | Standalone DDL for just `invoice_response_log` |
| `requirements.txt` | Python dependencies |

## 4. Configuration — `config/appsettings.yml`

```yaml
Logging:
  Folder: logs
  Level: INFO

MySql:
  Host: localhost
  User: sa
  Password: Augday@11
  Database: airflow

InvoiceApi:
  BaseUri: https://gatewayinternal.testapps.com

  Authentication:
    Endpoint: /api/v2/Authenticate
    ClientApiKey: REPLACE_WITH_CLIENT_API_KEY
    LoginUserName: REPLACE_WITH_LOGIN_USERNAME
    Password: REPLACE_WITH_LOGIN_PASSWORD

  GetInvoice:
    Endpoint: /api/v2/invoices
    InvoiceStatus: Approved
    PageSize: 50
    Expand: true

Output:
  Folder: output
  FileName: invoices_export.csv

  # Tables combined into the single export CSV, in join order. The first entry is
  # the base table (its JoinOn is ignored); every entry after that is left-joined
  # onto the running result using its own JoinOn column.
  # Query is optional: if omitted, it defaults to "SELECT * FROM <Name>". Set it to
  # any valid SQL string to select specific columns (or add WHERE/ORDER BY/etc.) --
  # it is run verbatim, so it MUST still return the JoinOn column for that entry
  # (except the base table, which has no JoinOn requirement).
  Tables:
    - Name: invoice_summary
      JoinOn:
      Query: SELECT * FROM invoice_summary
    - Name: invoice_detail
      JoinOn: invoice_id
      Query: SELECT * FROM invoice_detail
    - Name: invoice_line_detail
      JoinOn: detail_id
      Query: SELECT * FROM invoice_line_detail
    - Name: invoice_service
      JoinOn: line_detail_id
      Query: SELECT * FROM invoice_service
    - Name: invoice_charge
      JoinOn: service_pk
      Query: SELECT * FROM invoice_charge

Jobs:
  CBTS_AP:
    OutputPrefix: CBTS_AP_output

Sftp:
  Host: sftp.example.net
  Port: 22
  Username: ${SFTP_USERNAME}
  Password: ${SFTP_PASSWORD}
  RemoteDirectory: /Test/Airflow_Output/

Email:
  Enabled: true
  Smtp:
    Host: smtp.example.org
    Port: 25
    Username: ${SMTP_USERNAME}
    Password: ${SMTP_PASSWORD}
    UseTls: true
  Sender:
    Email: it-team@example.com
    Name: AP Automation
  Recipients:
    To: [ops-team@example.com]
    Cc: []
  Subject: "SFTP File Upload Successful - {filename}"
  Body: |
    Hello Team,
    The file {filename} has been successfully uploaded to the SFTP server.
    Upload Time: {upload_time}
  Attachment:
    Enabled: true
    FileName: "{filename}"
  FailureNotification:
    Enabled: true
    Subject: "SFTP File Upload Failed - {filename}"
    Body: |
      Hello Team,
      The file upload to the SFTP server has failed.
      File Name: {filename}
      Failure Time: {failure_time}
      Error Details: {error_message}
    Recipients:
      To: [ops-team@example.com]
      Cc: []
```

> **Before running the pipeline**, replace `ClientApiKey`, `LoginUserName`, and
> `Password` under `Authentication` with real credentials for the Invoice API.
> `Sftp.Username`/`Sftp.Password` and `Email.Smtp.Username`/`Email.Smtp.Password`
> are read from the environment via `${VAR_NAME}` placeholders (expanded by
> `config.py::_expand_env`) rather than stored in plain text — set
> `SFTP_USERNAME`, `SFTP_PASSWORD`, `SMTP_USERNAME`, `SMTP_PASSWORD` in the
> environment before running.

`Jobs.<JobName>.OutputPrefix` is looked up by `scripts/config.py::load_config()`
under the fixed key `CBTS_AP` and exposed as `cfg.job.output_prefix`; it's
prepended to the generated CSV file name (see below). `Sftp.*` configures the
Step 6 upload (`scripts/delivery.py::upload_to_sftp`) via `paramiko`. `Email.*`
configures Step 7 (`scripts/delivery.py::send_success_email` /
`send_failure_email`) — `{filename}`, `{upload_time}`, `{failure_time}`, and
`{error_message}` are substituted into `Subject`/`Body`/`Attachment.FileName` at
send time. `Email.Enabled: false` skips sending entirely.

`Logging.Folder` follows the same relative/absolute resolution rules as
`Output.Folder` (see below); `Logging.Level` is any standard Python logging level
name (`DEBUG`, `INFO`, `WARNING`, `ERROR`) and defaults to `INFO` if omitted.

`Output.Folder` may be relative (resolved against the project root, e.g. `output` →
`<project_root>/output`) or an absolute path; it's created automatically if it
doesn't exist. `Output.FileName` is the **base** name for the combined CSV; the
file actually written by `scripts/export_invoices_csv.py::export_invoices_csv()`
is always named
`<Jobs.CBTS_AP.OutputPrefix>_<base>_<ddMMyyyy_hhmmss>.csv` (e.g. `Output.FileName:
invoices_export.csv` → `CBTS_AP_output_invoices_export_26082026_174309.csv`), so
every run produces a distinct file instead of overwriting the previous one. This
exact file name (via `os.path.basename()` of the returned path) is what gets
uploaded to SFTP and referenced in the email template's `{filename}` — see
`build_export_filename()` in `scripts/export_invoices_csv.py`.

`Output.Tables` drives the CSV join entirely from config — no table names or SQL
are hardcoded in `export_invoices_csv.py`. The first entry is the base table,
every entry after it is left-joined onto the running result on its `JoinOn`
column. To add another table to the export, drop one, or change join order, edit
this list only — no code change needed. Each entry's `Query` is run **verbatim**
against MySQL — omit it for the default `SELECT * FROM <Name>`, or set it to
select specific columns, e.g.:

```yaml
    - Name: invoice_detail
      JoinOn: invoice_id
      Query: SELECT invoice_id, vendor_name, invoice_type, total_amount_due FROM invoice_detail
```

The only requirement is that a custom `Query` must still return the `JoinOn`
column for that entry (not required for the base table, which has no `JoinOn`).
Columns from the base table keep their original names; columns from every joined
table that collide with an existing column are suffixed with `_<table name>`
(e.g. `invoice_number_invoice_detail`) so nothing is silently overwritten.

## 5. Function Reference

### `scripts/config.py`
- `load_config(path=APPSETTINGS_PATH) -> AppConfig` — reads and parses
  `config/appsettings.yml` (path resolved relative to the project root, i.e.
  `scripts/../config/appsettings.yml`).

### `scripts/logging_config.py`
- `setup_logging(cfg: LoggingConfig, run_name="process_invoices") -> str` —
  configures the **root** logger with two handlers: a `FileHandler` writing to
  `<Logging.Folder>/<run_name>_<YYYYMMDD_HHMMSS>.log` (one fresh file per run) and
  a `StreamHandler` writing the same formatted lines to the console. Returns the
  log file path. Also quiets `mysql.connector` and `urllib3`'s own INFO-level
  chatter down to `WARNING` so the log stays focused on pipeline events. Because
  every module logs via `logging.getLogger(__name__)`, calling this once at the
  start of `main()` is enough to route every module's log calls to both outputs.

### `scripts/field_maps.py`
- `map_record(record: dict, field_map: dict) -> dict` — converts one API record dict
  into a DB-column-keyed dict using the given field map. Field maps are loaded from
  `config/field_maps.yml` at import time.

### `scripts/db.py`
- `get_connection(cfg: MySqlConfig) -> MySQLConnection` — opens a MySQL connection.

### `scripts/auth_client.py`
- `authenticate(cfg: InvoiceApiConfig) -> str` — POSTs `loginUserName`/`password` with
  the `ClientApiKey` header to the Authenticate endpoint; returns `data.accessToken`.
  Raises `RuntimeError` if `success` is false or no token is returned. Logs the
  request URL/username before calling, and the failure reason if authentication
  is rejected.

### `scripts/invoice_client.py`
- `get_invoice(cfg: InvoiceApiConfig, token: str, invoice_number: str) -> requests.Response` —
  calls `GET {BaseUri}/api/v2/invoices` with `invoiceNumber`, `invoiceStatus`,
  `page`, `pageSize`, `sortBy`, `sortOrder`, `expand`, `export` query params and a
  `Bearer` auth header. Returns the raw `requests.Response` (caller decides how to
  handle non-2xx / bad JSON).

### `scripts/repository.py`
- `upsert(cursor, table, data, unique_cols=None) -> int` — generic
  `INSERT ... ON DUPLICATE KEY UPDATE`, returns the affected row's PK (`lastrowid`).
- `insert(cursor, table, data) -> int` — generic plain insert, returns `lastrowid`.
- `insert_response_log(cursor, invoice_number, request_url, http_status_code, is_success, response_message, response_body, error_message=None) -> int` —
  writes one row to `invoice_response_log`.
- `upsert_invoice_summary(cursor, record, log_id) -> int` — maps + upserts into
  `invoice_summary` keyed on `invoice_id`.
- `upsert_invoice_detail(cursor, record, log_id) -> int` — maps + upserts into
  `invoice_detail` keyed on `invoice_id`.
- `insert_invoice_line_detail(cursor, detail_id, service_total_count) -> int`
- `insert_invoice_service(cursor, line_detail_id, service_record) -> int`
- `insert_invoice_charge(cursor, service_pk, charge_record) -> int`
- `update_ap_invoice_status(cursor, invoice_number, api_status, response_obj, response_status_code) -> None` —
  updates `ap_invoices.ap_invoice_api_status` / `api_response_obj` /
  `api_response_status_code` for the matching `ap_invoice_number`.
- `store_invoice_record(cursor, record, log_id) -> None` — orchestrates one full
  record: summary → detail → (clear old nested rows) → line_detail → service → charge.

### `scripts/process_invoices.py` — **main entry point**
Every log line this module emits is prefixed with the step number from the §1
diagram, so a run's log file (or console output) reads as a step-by-step trace.

- `get_invoice_numbers(cursor) -> pd.DataFrame` — **Step 2**. `SELECT DISTINCT
  ap_invoice_number FROM ap_invoices WHERE ap_invoice_number IS NOT NULL`. Logs a
  **warning** if the result is empty (the #1 cause of "ran fine but nothing was
  written anywhere" — the loop below simply has nothing to iterate), otherwise
  logs the row count.
- `process_invoice(cursor, api_cfg, token, invoice_number) -> str` — **Steps 3–4**
  for one invoice: calls the Get Invoice API and logs the HTTP status/URL
  (Step 3), then updates `ap_invoices` and — only on `SUCCESS` — persists every
  record via `store_invoice_record` (Step 4). Returns the derived status string
  (`SUCCESS` / `PENDING` / `FAILED`, see §6) so `main()` can tally the run.
- `main() -> None` — loads config, sets up logging (`setup_logging`), runs
  **Step 1** (authenticate — any failure is logged with full traceback before
  re-raising), opens one DB connection, runs **Step 2** then loops every invoice
  number through **Steps 3–4**, committing after each and logging each one's
  outcome, logs a final `N SUCCESS, N PENDING, N FAILED` summary, rolls back the
  whole DB portion of the run on any unhandled exception (logged via
  `logger.exception` first), then — after the DB connection is closed — runs
  **Step 5** (`export_invoices_csv(cfg)`, reusing the already-loaded config),
  **Step 6** (`upload_to_sftp`) and **Step 7** (`send_success_email`) using the
  exact file name `export_invoices_csv()` returned. If Step 5, 6, or 7 raises,
  the exception is logged and `send_failure_email(cfg.email, output_filename,
  error)` is sent (best-effort — its own failure is logged but does not mask
  the original error) before re-raising.
  **This is the function to run/schedule** — invoked directly via
  `python scripts/process_invoices.py` or by the Airflow DAG
  (`dags/invoice_sync_dag.py`).

### `scripts/fetch_ap_invoices.py` (standalone utility, not part of the pipeline)
- `fetch_ap_invoices() -> pd.DataFrame` — ad hoc read of `ap_invoices` via SQLAlchemy,
  useful for quick inspection in a REPL/notebook.

### `scripts/export_invoices_csv.py`
- `get_engine(cfg: MySqlConfig)` — SQLAlchemy engine (password URL-encoded).
- `build_export_filename(cfg: AppConfig, timestamp: datetime | None = None) -> str` —
  builds the actual CSV file name: `Output.FileName`'s base + `_<ddMMyyyy_hhmmss>`
  + its extension, prefixed with `Jobs.CBTS_AP.OutputPrefix` + `_` when set.
  `timestamp` defaults to `datetime.now()`; overridable for tests.
- `resolve_output_path(cfg: AppConfig, filename: str | None = None) -> str` —
  resolves `Output.Folder` (defaulting `filename` to `Output.FileName` verbatim
  if not given) into an absolute path, creating the folder if needed.
- `build_invoice_export(engine, tables: list[ExportTableConfig]) -> pd.DataFrame` —
  driven entirely by `Output.Tables` from config (no table names or SQL
  hardcoded): runs the first (base) table's `Query` as-is, then for each
  subsequent table runs its own `Query` and left-joins the result onto the
  running result on that entry's `JoinOn` column. `Query` defaults to
  `SELECT * FROM <Name>` (set by `config.py::load_config`) but can be any SQL
  string, e.g. to select specific columns. Columns from a joined table that
  collide with an existing column are suffixed `_<table name>`. Logs which table
  it's reading/joining as it goes.
- `export_invoices_csv(cfg: AppConfig | None = None) -> str` — **Step 5**. Runs
  the join and writes it to `resolve_output_path(cfg, build_export_filename(cfg))`
  via `DataFrame.to_csv(index=False)` — so every run gets its own timestamped
  file instead of overwriting the last one; logs the row count written; returns
  the path written. Accepts an already-loaded `cfg` (used by
  `process_invoices.py::main()` to avoid re-reading `appsettings.yml`) or loads
  its own via `load_config()` when called standalone
  (`python scripts/export_invoices_csv.py`).

### `scripts/delivery.py`
- `upload_to_sftp(cfg: SftpConfig, local_path: str, filename: str) -> str` —
  **Step 6**. Opens a `paramiko` SFTP connection and puts `local_path` at
  `Sftp.RemoteDirectory/<filename>`; logs the local/remote paths on success.
  Raises `RuntimeError` up front if `Sftp.Username`/`Sftp.Password` still contain
  an unexpanded `${...}` placeholder (i.e. the environment variable was never
  set).
- `send_success_email(cfg: EmailConfig, filename: str, output_path: str) -> None` —
  **Step 7**. Formats `Email.Subject`/`Email.Body` with `{filename}` and
  `{upload_time}` (UTC, ISO 8601), attaches `output_path` under
  `Email.Attachment.FileName.format(filename=filename)` when
  `Email.Attachment.Enabled`, and sends via `Email.Smtp.*`. No-ops if
  `Email.Enabled` is false.
- `send_failure_email(cfg: EmailConfig, filename: str, error: Exception) -> None` —
  formats `Email.FailureNotification.Subject`/`Body` with `{filename}`,
  `{failure_time}` (UTC, ISO 8601), and `{error_message}` (`str(error)`), and
  sends to `Email.FailureNotification.Recipients`. No-ops if
  `Email.FailureNotification.Enabled` is false.
- `_send_message(...)` (shared by both) — raises `RuntimeError` up front if
  `Email.Smtp.Username`/`Password` still contain an unexpanded `${...}`
  placeholder; logs `subject`/`to`/`cc`/`attachment` on successful send.

### `dags/invoice_sync_dag.py`
- Adds `scripts/` to `sys.path` and imports `process_invoices.main` as
  `run_invoice_sync`.
- Defines DAG `invoice_sync_dag` (`schedule_interval="@daily"`, `catchup=False`)
  with a single `PythonOperator` task, `run_invoice_sync`, that calls
  `process_invoices.main()`.

## 6. Status Derivation Logic

For each invoice number, `process_invoice()` classifies the API response as:

| Condition | `api_status` |
|---|---|
| HTTP not OK, or JSON missing, or `payload.success` is false | `FAILED` |
| `success` true but `data.records` is empty | `PENDING` |
| `success` true and `data.records` has at least one record | `SUCCESS` |

Only on `SUCCESS` are the nested `invoice_summary` / `invoice_detail` / line item
rows written; `FAILED` and `PENDING` still update `ap_invoices` and log the raw
response, but skip the detail tables.

## 7. Execution Steps

### 7.1 Prerequisites
- Python 3.12+
- MySQL Server running locally with the `airflow` database
- Network access to the Invoice API `BaseUri`, the SFTP host, and the SMTP host
- Valid `ClientApiKey` / `LoginUserName` / `Password` for the Invoice API
- `SFTP_USERNAME`, `SFTP_PASSWORD`, `SMTP_USERNAME`, `SMTP_PASSWORD` set in the
  environment (see §4)

### 7.2 Install dependencies
```bash
python -m pip install -r requirements.txt
```

### 7.3 Create the database schema
Run against the `airflow` database (MySQL Workbench, CLI, or any client):
```bash
mysql -h localhost -u sa -p airflow < sql/create_tables.sql
```
This creates all 7 tables (if they don't already exist) and seeds `ap_invoices`
with 10 sample rows (`INV-10001`…`INV-10010`).

### 7.4 Configure credentials
Edit `config/appsettings.yml` and fill in the real `ClientApiKey`, `LoginUserName`,
and `Password` under `InvoiceApi.Authentication`; set `SFTP_USERNAME`,
`SFTP_PASSWORD`, `SMTP_USERNAME`, `SMTP_PASSWORD` in the environment for the
`${...}`-referenced `Sftp`/`Email.Smtp` credentials (see §4).

### 7.5 Run the pipeline directly
```bash
python scripts/process_invoices.py
```
This runs all 7 steps in order (see §1 diagram):
1. **Step 1** — authenticate once and obtain a bearer token.
2. **Step 2** — pull every distinct `ap_invoice_number` from `ap_invoices`.
3. **Step 3** — for each invoice number, call the Get Invoice API and log the raw
   response to `invoice_response_log`.
4. **Step 4** — update `ap_invoices` (`ap_invoice_api_status`, `api_response_obj`,
   `api_response_status_code`) and, only on `SUCCESS`, persist the nested payload
   into `invoice_summary` → `invoice_detail` → `invoice_line_detail` →
   `invoice_service` → `invoice_charge`. Commits after every invoice; rolls back
   the entire DB portion of the run if an unhandled error occurs.
5. **Step 5** — once every invoice has been processed, automatically generates the
   combined CSV export (same as running `scripts/export_invoices_csv.py`
   manually, see §7.8) to `<Output.Folder>/<Jobs.CBTS_AP.OutputPrefix>_<Output.
   FileName base>_<ddMMyyyy_hhmmss>.csv`.
6. **Step 6** — uploads that exact CSV to `Sftp.RemoteDirectory` and logs the
   result.
7. **Step 7** — sends the `Email.*` template (CSV attached) and logs the result.
   If Step 5, 6, or 7 raises, a best-effort `Email.FailureNotification` is sent
   instead before the original error is re-raised.

Every run prints progress to the terminal **and** writes the same lines to a fresh
timestamped file at `logs/process_invoices_<YYYYMMDD_HHMMSS>.log` (path from
`Logging.Folder` in config). If a run appears to succeed but no rows show up in
any table, check that file first — the most common cause is
`get_invoice_numbers()` finding zero rows (an empty or all-NULL
`ap_invoice_number` column in `ap_invoices`), which is logged as a `WARNING` and
means the per-invoice loop never runs at all.

### 7.6 Run the pipeline via Airflow
Copy or symlink `dags/invoice_sync_dag.py` (and the `scripts/` + `config/` folders
it depends on) into your Airflow deployment's `dags/` folder — or point
`AIRFLOW_HOME`/`dags_folder` at this project's `dags/` directory. Airflow will pick
up the `invoice_sync_dag` DAG automatically; trigger it manually from the UI/CLI or
let the `@daily` schedule run it. `apache-airflow` must be installed in that
environment (it is intentionally **not** listed in this project's
`requirements.txt`, since it belongs to the Airflow deployment, not this pipeline's
own dependency set).

### 7.7 Ad hoc data inspection
```bash
python scripts/fetch_ap_invoices.py
```
Prints the current contents of `ap_invoices` (filtered to `ap_paymentfile_id = 1001`
in the current query — edit `QUERY` in `scripts/fetch_ap_invoices.py` as needed).

### 7.8 Export all invoice data to CSV (Step 5, standalone)
```bash
python scripts/export_invoices_csv.py
```
`process_invoices.py` already runs this as part of Steps 5-7 (§7.5), so this is
only needed to **regenerate a CSV on its own** — e.g. after manually editing
`Output.Tables`, or to refresh the export without re-hitting the Invoice API or
triggering an SFTP upload/email. Reads every table listed under `Output.Tables`
in `config/appsettings.yml` (default: `invoice_summary`, `invoice_detail`,
`invoice_line_detail`, `invoice_service`, `invoice_charge`), joins them in the
configured order/join-key into one denormalized table (one row per charge
line), and writes a single, freshly timestamped CSV to
`<Output.Folder>/<Jobs.CBTS_AP.OutputPrefix>_<Output.FileName base>_<ddMMyyyy_hhmmss>.csv`
(default folder `output/`, relative to the project root — created automatically
if it doesn't exist; e.g. `output/CBTS_AP_output_invoices_export_26082026_174309.csv`).
Edit `Output.Tables` to add/remove/reorder tables in the export without touching
code; each run leaves the previous export file(s) in place rather than
overwriting them.

## 8. Technical Notes

- **Config format**: all configuration lives in YAML (`config/appsettings.yml`,
  `config/field_maps.yml`), parsed via `PyYAML`. No secrets or endpoints are
  hardcoded in Python — only referenced through `scripts/config.py` /
  `scripts/field_maps.py`. Both loaders resolve their YAML path relative to the
  project root (`os.path.dirname(os.path.dirname(__file__))/config/...`), so they
  work regardless of the current working directory the scripts are launched from.
- **DB access pattern**: `scripts/process_invoices.py` uses a raw `mysql.connector`
  connection/cursor (not SQLAlchemy) so it can rely on `cursor.lastrowid` to chain
  auto-increment IDs across the summary → detail → line_detail → service → charge
  insert sequence within a single transaction. `scripts/fetch_ap_invoices.py` uses
  SQLAlchemy + pandas separately for simple reads.
- **Logging**: `scripts/logging_config.py::setup_logging()` configures Python's
  root logger once at the top of `process_invoices.py::main()` with a
  `FileHandler` (one fresh timestamped file per run under `Logging.Folder`) and a
  `StreamHandler` (same lines to the console). Every module logs via
  `logging.getLogger(__name__)`, so nothing beyond that one `setup_logging()` call
  is needed for every module's log output to reach both destinations. Third-party
  noise from `mysql.connector` and `urllib3` is capped at `WARNING` so the log
  stays readable. This was added specifically to make a "ran without error but no
  data anywhere" run diagnosable — `get_invoice_numbers()` logs a `WARNING` when
  it finds zero rows, which is the most common root cause of that symptom.
- **Airflow integration**: `dags/invoice_sync_dag.py` inserts `scripts/` onto
  `sys.path` at import time and calls `process_invoices.main()` directly from a
  `PythonOperator`, rather than shelling out — so it shares the same Python
  environment/dependencies (`requirements.txt`) as running the script by hand.
- **Password with special characters**: MySQL passwords containing `@` (e.g.
  `Augday@11`) must be URL-encoded (`urllib.parse.quote_plus`) when building a
  SQLAlchemy connection string, otherwise the `@` is misread as the
  user@host separator. `mysql.connector.connect(**kwargs)` (used in `scripts/db.py`)
  does not have this issue since it takes the password as a discrete argument.
  Passwords appear here in plain text in local config only; do not commit real
  production keys.
- **Field mapping / typos preserved**: `config/field_maps.yml` intentionally
  preserves a spelling inconsistency present in the source API
  (`invoiceApporvedNotapporvedBy` → `invoice_apporved_notapporved_by`) so the
  mapping stays exact and unambiguous.
- **Idempotency**: the whole pipeline is safe to re-run — `CREATE TABLE IF NOT
  EXISTS`, `INSERT IGNORE` for seed data, `ON DUPLICATE KEY UPDATE` for
  summary/detail, and delete-then-reinsert for nested line items.
- **ISO 8601 date conversion**: the Invoice API returns dates as ISO 8601 strings
  (e.g. `"2026-05-07T00:00:00Z"` or `"2026-08-25T09:28:01.099Z"`), which MySQL's
  `DATETIME` columns reject outright (`Error 1292: Incorrect datetime value`).
  `scripts/field_maps.py::map_record()` detects any string value matching that
  shape via regex and converts it to a naive `datetime` object before it reaches
  `repository.py`. This is name-agnostic — it applies to every field in every map
  (`SUMMARY_FIELD_MAP`, `DETAIL_FIELD_MAP`, `SERVICE_FIELD_MAP`,
  `CHARGE_FIELD_MAP`), so any date field, present or added later, is covered
  automatically without per-field code changes. Non-date strings (invoice numbers,
  descriptions, etc.) never match the pattern and pass through unchanged.
- **Other potential data-shape risks (not yet hit, flagged for awareness)**:
  freeform text fields such as `invoice_detail.description`-adjacent columns,
  `reason`, `address`, `billing_street_address`, and `remit_street_address` are
  `VARCHAR(200)`–`VARCHAR(500)` in the DDL; if the live API ever returns values
  longer than that, MySQL will raise `Error 1406: Data too long for column`. This
  hasn't been observed yet (no real API data has flowed through), so column sizes
  haven't been preemptively widened — if it happens, the fix is a one-line `ALTER
  TABLE ... MODIFY COLUMN ... TEXT` in `sql/create_tables.sql` for the affected
  column(s).
