# Mangesh Automation — Invoice Sync Pipeline

For a given interface (`interfaceconfiguration.InterfaceId`), authenticates
against that interface's Invoice API, pulls new AP payment-file batches and
their invoice numbers from the upstream platform (Get Payment Batches / Get
Invoice List APIs) into `ap_payment_file_details` / `ap_invoices`, then finds
every open (`'New'`) payment-file batch, pulls the invoice numbers under each
batch from `airflow.ap_invoices`, fetches full invoice detail for each
invoice number, writes the outcome back
onto `ap_invoices`, and stores the full nested API response
(summary → detail → line items → services → charges) into normalized tables.
Each batch gets its own tracking UUID (`ap_invoices_process_log`) so the CSV
export generated for that batch only contains that batch's invoices — instead
of every invoice ever processed — and the batch's status is written back to
`ap_payment_file_details` (`Success`/`Failure`) when it finishes.

## 1. Architecture / Process Flow

```
                 ┌───────────────────────────────┐
                 │ interfaceconfiguration          │  (one row per interface,
                 │  WHERE InterfaceId = ?            │   keyed by InterfaceId)
                 └───────────────┬───────────────────┘
                                  ▼
        ┌───────────────────────────────────────────────────────────────┐
        │ Step 1-2: Load interface config  (process_invoices.py --interface-id) │
        │   repository.py::load_interface_configuration() maps SFTP_*/SMTP_*/      │
        │   Platform_*/Email_* columns onto config.py's dotted keys, overlaid          │
        │   onto appsettings.yml (DB values win; NULL columns fall back to yml)          │
        └───────────────┬───────────────────────────────────────────────────────────┘
                         ▼
        ┌───────────────────────────────────────────────────────────────┐
        │ Authenticate  (auth_client.py)                                      │
        │   POST {BaseUri}/api/v2/Authenticate -> Bearer token                   │
        └───────────────┬───────────────────────────────────────────────────────┘
                         ▼
        ┌───────────────────────────────────────────────────────────────────────────┐
        │ Step 2a: Sync payment files + invoices from upstream  (sync_payment_files.py) │
        │   GET {BaseUri}/invoices/invoiceAPBatches (fromDate/toDate window)             │
        │     -> new batches inserted into ap_payment_file_details (ap_batch_status='New') │
        │     -> raw record also inserted into ap_batch_details                              │
        │   for each new batch: GET {BaseUri}/invoices/invoiceAPBatchesDetails?paymentFileId= │
        │     -> invoiceAPBatchDetails[].invoiceNumber inserted into ap_invoices              │
        │     -> each invoiceAPBatchDetails[] entry also inserted into ap_batch_invoice_details│
        │        -> its allocationValues[] -> ap_batch_invoice_allocation_values (child rows)  │
        │        -> its custom[] -> ap_batch_invoice_custom (child rows)                       │
        └───────────────┬───────────────────────────────────────────────────────────────┘
                         ▼
        ┌───────────────────────────────────────────────────────────────┐
        │ Step 3: Find open payment files  (repository.py::get_open_payment_files)  │
        │   SELECT * FROM ap_payment_file_details                                  │
        │   WHERE interface_id = ? AND ap_batch_status = 'New'                        │
        └───────────────┬───────────────────────────────────────────────────────────┘
                         ▼
        ┌── for each open payment file (process_invoices.py::process_payment_file) ──────────┐
        │                                                                                       │
        │  Step 4: Pull invoices for this payment file                                            │
        │    SELECT DISTINCT ap_invoice_number FROM ap_invoices                                     │
        │    WHERE ap_paymentfile_id = <payment file's id>                                            │
        │                                                                                                │
        │  Step 5: Create process log  (repository.py::create_process_log)                                │
        │    INSERT INTO ap_invoices_process_log                                                             │
        │      (proces_datetime, invoice_process_uuid, ap_payment_file_detail_id)                              │
        │    -> one row per payment-file run; generates a fresh UUID for this run                                │
        │                                                                                                            │
        │  Step 6: Process every invoice in this batch  (process_invoices.py::process_invoice)                       │
        │    ┌─ for each invoice_number ──────────────────────────────────────────────────┐                          │
        │    │  Get Invoice API call -> invoice_response_log (+ invoice_process_uuid)         │                          │
        │    │  update ap_invoices (status / raw response)                                       │                          │
        │    │  on SUCCESS: invoice_summary (+ invoice_process_uuid,                                │                          │
        │    │    ap_payment_file_detail_id) -> invoice_detail -> invoice_line_detail                  │                          │
        │    │    -> invoice_service -> invoice_charge                                                   │                          │
        │    └───────────────────────────────────────────────────────────────────────────────┘                          │
        │                                                                                                            │
        │  Generate output CSV, scoped to this run  (export_invoices_csv.py)                                            │
        │    base query (invoice_summary) filtered WHERE invoice_process_uuid = <this run's uuid>                         │
        │    -- everything joined afterwards inherits the scoping through invoice_id                                        │
        │  Upload to SFTP + send success/failure email  (delivery.py)                                                        │
        │                                                                                                            │
        │  Update ap_payment_file_details: ap_batch_status = 'Success'/'Failure',                                        │
        │    processed_date = now, log_id = <this run's ap_invoices_process_log.id>                                          │
        └────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 1a. Folder Structure

```
mangesh_automation/
├── config/
│   ├── appsettings.yml       MySQL connection + fallback defaults (see §4)
│   └── field_maps.yml        API field -> DB column mappings
├── scripts/
│   ├── config.py              loads appsettings.yml, overlays interface_values
│   ├── logging_config.py      per-run file + console logging setup
│   ├── field_maps.py          loads field_maps.yml
│   ├── db.py                  MySQL connection helper
│   ├── auth_client.py         Authenticate API client
│   ├── invoice_client.py      Get Invoice / Get Payment Batches / Get Invoice List API clients
│   ├── repository.py          all DB read/write functions
│   ├── sync_payment_files.py  pulls new payment files + invoice numbers from upstream API
│   ├── process_invoices.py    main orchestrator (entry point)
│   ├── fetch_ap_invoices.py   standalone ap_invoices reader
│   ├── export_invoices_csv.py joins all invoice tables into one timestamped CSV
│   └── delivery.py            SFTP upload + success/failure email
├── dags/
│   └── invoice_sync_dag.py    Airflow DAG that runs process_invoices.main(interface_id=...)
├── sql/
│   ├── create_tables.sql                  full DDL for a fresh install + seed data
│   ├── migrate_payment_file_processing.sql catch-up ALTERs for a pre-existing DB
│   └── create_invoice_response_log.sql    standalone DDL for the log table
├── output/                    generated CSV export lands here (see Output config)
├── logs/                      one timestamped log file per process_invoices.py run
├── requirements.txt
└── README.md
```

## 2. Database Schema

Defined in [`sql/create_tables.sql`](sql/create_tables.sql) (`CREATE TABLE IF NOT
EXISTS`, safe to re-run on a fresh database). If a database already has these
tables in their pre-payment-file-tracking shape (interfaceconfiguration,
ap_payment_file_details, ap_invoices_process_log, invoice_summary already exist
but predate this flow), run
[`sql/migrate_payment_file_processing.sql`](sql/migrate_payment_file_processing.sql)
once instead — `CREATE TABLE IF NOT EXISTS` is a no-op against tables that
already exist, so it won't retroactively add new columns.

| Table | Purpose | Key relationship |
|---|---|---|
| `interfaceconfiguration` | One wide row per interface (SFTP/SMTP/Invoice API/email settings) | `InterfaceId` (PK) |
| `ap_invoices` | Source list of invoices to process; also stores the last API call outcome | `ap_paymentfile_id` → `ap_payment_file_details.id` |
| `ap_payment_file_details` | One row per payment-file batch; `ap_batch_status` (`New`/`Success`/`Failure`) drives the foreach loop | `interface_id` → `interfaceconfiguration.InterfaceId` |
| `ap_batch_details` | Raw Get Payment Batches API record for a batch (client, status, counts, amounts) | `ap_payment_file_detail_id` → `ap_payment_file_details.id` (1:1) |
| `ap_batch_invoice_details` | Raw `invoiceAPBatchDetails[]` entry from the Get Invoice List API — flat invoice-line fields (org/vendor/dates/amounts) | `ap_payment_file_detail_id` → `ap_payment_file_details.id` |
| `ap_batch_invoice_allocation_values` | `invoiceAPBatchDetails[].allocationValues[]` child rows | `batch_invoice_detail_id` → `ap_batch_invoice_details.id` |
| `ap_batch_invoice_custom` | `invoiceAPBatchDetails[].custom[]` child rows | `batch_invoice_detail_id` → `ap_batch_invoice_details.id` |
| `ap_invoices_process_log` | One row per payment-file **run**; its `invoice_process_uuid` is threaded into `invoice_response_log` and `invoice_summary` | `ap_payment_file_detail_id` → `ap_payment_file_details.id` |
| `invoice_response_log` | One row per Get Invoice API call: raw JSON response, HTTP status, timestamp, `invoice_process_uuid` | root of the invoice-detail chain |
| `invoice_summary` | Short `records[]` shape from the API | `invoice_id` (unique) · `log_id` → `invoice_response_log` · `invoice_process_uuid` / `ap_payment_file_detail_id` → this run's batch |
| `invoice_detail` | Full `records[]` shape (all ~77 fields, when `expand=true`) | `invoice_id` (unique) → `invoice_summary` · `log_id` → `invoice_response_log` |
| `invoice_line_detail` | `invoiceDetails[]` wrapper (`serviceTotalCount`) | `detail_id` → `invoice_detail` (cascade delete) |
| `invoice_service` | `invoiceServices[]` | `line_detail_id` → `invoice_line_detail` (cascade delete) |
| `invoice_charge` | `invoiceCharges[]` | `service_pk` → `invoice_service` (cascade delete) |

**Idempotency**: `invoice_summary` / `invoice_detail` are upserted on `invoice_id`
(`ON DUPLICATE KEY UPDATE`) — so re-processing the same invoice under a *new*
run updates that invoice's `invoice_process_uuid` in place rather than adding a
row. Nested rows (`invoice_line_detail` → `invoice_service` → `invoice_charge`)
are deleted and re-inserted per `detail_id` on every run. What used to make
re-runs look like "duplicates" was the CSV export pulling the whole table's
history unscoped; the export now filters `invoice_summary` by the current run's
`invoice_process_uuid` (see §1), so each batch's output only contains that
batch's invoices.

## 3. Project Files

| File | Role |
|---|---|
| `config/appsettings.yml` | MySQL connection, Invoice API base structure, `Output.Tables` join config, logging — plus fallback `Sftp`/`Email`/`InvoiceApi.Authentication` defaults for any interface whose `interfaceconfiguration` row leaves those columns `NULL` |
| `config/field_maps.yml` | API field (camelCase) → DB column (snake_case) mappings for Summary / Detail / Service / Charge / BatchDetails / BatchInvoiceDetails / BatchInvoiceAllocationValue / BatchInvoiceCustom |
| `scripts/config.py` | Loads `config/appsettings.yml` into typed dataclasses (`AppConfig`, `MySqlConfig`, `InvoiceApiConfig`, `AuthenticationConfig`, `GetInvoiceConfig`, `GetPaymentBatchesConfig`, `GetInvoiceListConfig`, `LoggingConfig`, `JobConfig`, `SftpConfig`, `EmailConfig`); `load_config(interface_values=...)` overlays a dict of dotted keys (e.g. `"Sftp.Password"`) on top of the YAML before building the dataclasses |
| `scripts/logging_config.py` | `setup_logging(cfg)` — configures one timestamped log file per run plus console output |
| `scripts/field_maps.py` | Loads `config/field_maps.yml`, exposes `SUMMARY_FIELD_MAP` / `DETAIL_FIELD_MAP` / `SERVICE_FIELD_MAP` / `CHARGE_FIELD_MAP` / `BATCH_DETAILS_FIELD_MAP` / `BATCH_INVOICE_DETAIL_FIELD_MAP` / `BATCH_INVOICE_ALLOCATION_VALUE_FIELD_MAP` / `BATCH_INVOICE_CUSTOM_FIELD_MAP` and `map_record()` |
| `scripts/db.py` | `get_connection(cfg)` — raw `mysql.connector` connection (used for transactional multi-table writes) |
| `scripts/auth_client.py` | `authenticate(cfg)` — calls the Authenticate API, returns the bearer token |
| `scripts/invoice_client.py` | `get_invoice(cfg, token, invoice_number)` — calls the Get Invoice API; `get_payment_batches(cfg, token, from_date, to_date, page)` — calls the Get Payment Batches API; `get_invoice_list(cfg, token, payment_file_id, page)` — calls the Get Invoice List API |
| `scripts/repository.py` | All DB read/write functions (see §5) |
| `scripts/sync_payment_files.py` | `sync_payment_files(cursor, cfg, token, interface_id)` — pulls new payment-file batches (Get Payment Batches API) into `ap_payment_file_details` + the raw record into `ap_batch_details`, then for each new batch pulls its invoice numbers (Get Invoice List API) into `ap_invoices` + each raw `invoiceAPBatchDetails[]` entry into `ap_batch_invoice_details` (its nested `allocationValues[]`/`custom[]` into their own child tables); paginates both APIs via `data.totalPages` and skips batches/invoice numbers already stored |
| `scripts/process_invoices.py` | Main orchestrator — entry point for the full pipeline, takes `--interface-id` |
| `scripts/fetch_ap_invoices.py` | Standalone helper — reads `ap_invoices` into a pandas DataFrame (ad hoc use / debugging) |
| `scripts/export_invoices_csv.py` | Joins `invoice_summary` → `invoice_detail` → `invoice_line_detail` → `invoice_service` → `invoice_charge`, optionally scoped to one `invoice_process_uuid`, and writes one combined, timestamped CSV |
| `scripts/delivery.py` | `upload_to_sftp()` puts the CSV on the SFTP server; `send_success_email()` / `send_failure_email()` send the configured email template with the CSV attached. Both log their outcome. |
| `dags/invoice_sync_dag.py` | Airflow DAG — schedules `scripts/process_invoices.py:main(interface_id=INTERFACE_ID)` as a `PythonOperator` task |
| `sql/create_tables.sql` | Full DDL for every table (fresh-install shape) + seed rows for `ap_invoices` / `ap_payment_file_details` |
| `sql/migrate_payment_file_processing.sql` | Catch-up `ALTER TABLE` statements for a database that already has these tables in their older shape |
| `sql/create_invoice_response_log.sql` | Standalone DDL for just `invoice_response_log` |
| `sql/create_batch_detail_tables.sql` | Standalone DDL for the 4 payment-file-sync tables (`ap_batch_details`, `ap_batch_invoice_details`, `ap_batch_invoice_allocation_values`, `ap_batch_invoice_custom`) — for a database that already runs this pipeline but predates that feature |
| `sql/drop_aprequestpaymentdetails.sql` / `sql/drop_aprequestdetails.sql` | Drop the two legacy tables neither this pipeline nor the tracker ever read (see §8) |
| `requirements.txt` | Python dependencies |

## 4. Configuration

Configuration now comes from **two places**, merged at runtime:

1. **`config/appsettings.yml`** — MySQL connection (needed to even reach the
   database, so it can't live in the database itself), the Invoice API's
   `BaseUri`/`GetInvoice` structure, `Output.Tables` (the CSV join
   definition), and `Logging`. It also holds `Sftp`/`Email`/
   `InvoiceApi.Authentication` blocks, but those now act only as **fallback
   defaults** for any column an interface's `interfaceconfiguration` row
   leaves `NULL`.
2. **`interfaceconfiguration`** (MySQL table, one row per interface) — the
   real source of SFTP/SMTP/Invoice-API-auth/email settings for a given
   `--interface-id`. `repository.py::load_interface_configuration()` reads the
   row for that `InterfaceId`, skips any column that's `NULL`/empty, and maps
   the rest onto the same dotted keys `config.py` uses:

   | `interfaceconfiguration` column | config key |
   |---|---|
   | `SFTP_Host` / `SFTP_Port` / `SFTP_UserName` / `SFTP_Password` / `SFTP_RemoteDirectory` | `Sftp.Host` / `Sftp.Port` / `Sftp.Username` / `Sftp.Password` / `Sftp.RemoteDirectory` |
   | `SMTP_Host` / `SMTP_Port` / `SMTP_UserId` / `SMTP_Password` / `SMTP_UseTLS` | `Email.Smtp.Host` / `Email.Smtp.Port` / `Email.Smtp.Username` / `Email.Smtp.Password` / `Email.Smtp.UseTls` |
   | `Platform_InstanceUrl` / `Platform_UserId` / `Platform_Password` / `Platform_AppAuthKey` | `InvoiceApi.BaseUri` / `InvoiceApi.Authentication.LoginUserName` / `...Password` / `...ClientApiKey` |
   | `Email_Enabled`, `Email_Sender_Email`, `Email_Sender_Name`, `Email_Recipients_To/Cc`, `Email_Subject`, `Email_Body`, `Email_Attachment_Enabled`, `Email_Attachment_FileName` | `Email.Enabled`, `Email.Sender.Email`, `Email.Sender.Name`, `Email.Recipients.To/Cc`, `Email.Subject`, `Email.Body`, `Email.Attachment.Enabled`, `Email.Attachment.FileName` |
   | `Failure_Notification_Enabled`, `Failure_Subject`, `Failure_Body`, `Failure_Recipients_To/Cc` | `Email.FailureNotification.Enabled/Subject/Body/Recipients.To/Cc` |
   | `Output_Directory` | `Output.Folder` |
   | `InterfaceName` | `Job.OutputPrefix` (the output filename prefix -- always present, so this always overrides any `Job.OutputPrefix` set in `appsettings.yml`) |

   `Email_Recipients_To/Cc` and `Failure_Recipients_To/Cc` are stored as text
   and parsed as a JSON array if the value starts with `[`, otherwise split on
   `,`/`;`. Boolean columns (`SMTP_UseTLS`, `Email_Enabled`, etc.) are cast
   with `bool()`. `Platform_DB_*` and `Platform_DB_AP_Query` columns exist in
   the table but aren't read by this pipeline yet — see §8.

`process_invoices.py::main()` builds the final `AppConfig` by calling
`load_config()` once for the YAML defaults, then again with
`interface_values=load_interface_configuration(cursor, interface_id)` to layer
the DB row on top.

`config/appsettings.yml`'s current shape:

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
  GetInvoice:
    Endpoint: /api/v2/invoices
    InvoiceStatus: Approved
    PageSize: 50
    Expand: true
  GetPaymentBatches:
    Endpoint: /invoices/invoiceAPBatches
    PageSize: 50
    LookbackDays: 1
  GetInvoiceList:
    Endpoint: /invoices/invoiceAPBatchesDetails
    PageSize: 50
    Expand: false

Output:
  Folder: output
  FileName: invoices_export.csv
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
```

`InvoiceApi.Authentication.ClientApiKey`/`LoginUserName`/`Password` and the
`Sftp`/`Email` blocks were removed from this file — they're expected to come
from `interfaceconfiguration` now. They can still be added back here (in the
same shape as before) as a fallback for any column not yet populated for a
given interface.

`Output.Tables` drives the CSV join entirely from config — no table names or
SQL are hardcoded in `export_invoices_csv.py`. The first entry is the base
table (must be `invoice_summary`, the only table carrying
`invoice_process_uuid`, for run-scoping to work), every entry after it is
left-joined onto the running result on its `JoinOn` column. `Query` defaults to
`SELECT * FROM <Name>` but can be any SQL string, e.g. to select specific
columns — it must still return the `JoinOn` column for that entry.

`Logging.Folder`/`Output.Folder` may be relative (resolved against the project
root) or absolute; both are created automatically if missing.

## 5. Function Reference

### `scripts/config.py`
- `load_config(path=APPSETTINGS_PATH, interface_values: dict | None = None) -> AppConfig` —
  reads `config/appsettings.yml`; if `interface_values` is given (dotted keys
  like `"Sftp.Password"` → value), those are set into the raw YAML dict before
  the typed dataclasses are built, so DB-sourced values win over the YAML
  defaults for whichever keys are present.

### `scripts/repository.py`
- `load_interface_configuration(cursor, interface_id: int) -> dict` — reads the
  `interfaceconfiguration` row for `InterfaceId = interface_id`
  (`IsActive = 1`), maps its columns onto dotted config keys (see §4); raises
  `ValueError` if no active row exists for that id.
- `get_open_payment_files(cursor, interface_id: int) -> list` — `SELECT * FROM
  ap_payment_file_details WHERE interface_id = ? AND ap_batch_status = 'New'`.
- `get_invoice_numbers_for_payment_file(cursor, payment_file_detail_id: int) -> list` —
  distinct `ap_invoice_number`s under that payment file.
- `get_existing_payment_file_ids(cursor, interface_id: int) -> set` — every
  upstream `paymentFileId` already present in `ap_payment_file_details` for
  this interface; used to skip batches already pulled.
- `insert_payment_file(cursor, interface_id, payment_file_id, batch_name) -> int` —
  inserts a new `ap_payment_file_details` row (`ap_batch_status='New'`) for a
  batch just pulled from the Get Payment Batches API.
- `insert_ap_invoice(cursor, payment_file_detail_id, invoice_number) -> int` —
  inserts a new `ap_invoices` row for an invoice number just pulled from the
  Get Invoice List API.
- `insert_batch_details(cursor, payment_file_detail_id, record) -> int` —
  maps + inserts the full raw Get Payment Batches API record into
  `ap_batch_details`.
- `insert_batch_invoice_detail(cursor, payment_file_detail_id, batch_name, detail_record) -> int` —
  maps + inserts one `invoiceAPBatchDetails[]` entry's flat fields into
  `ap_batch_invoice_details`.
- `insert_batch_invoice_allocation_value(cursor, batch_invoice_detail_id, allocation_record) -> int` —
  maps + inserts one `allocationValues[]` entry into
  `ap_batch_invoice_allocation_values`.
- `insert_batch_invoice_custom(cursor, batch_invoice_detail_id, custom_record) -> int` —
  maps + inserts one `custom[]` entry into `ap_batch_invoice_custom`.
- `create_process_log(cursor, payment_file_detail_id: int) -> (log_id, invoice_process_uuid)` —
  inserts one `ap_invoices_process_log` row for this run and returns its id
  and freshly generated UUID.
- `update_payment_file_status(cursor, payment_file_detail_id, status, log_id) -> None` —
  sets `ap_batch_status`, `processed_date = now()`, and `log_id` on
  `ap_payment_file_details`.
- `upsert(cursor, table, data, unique_cols=None) -> int` — generic
  `INSERT ... ON DUPLICATE KEY UPDATE`, returns the affected row's PK.
- `insert(cursor, table, data) -> int` — generic plain insert, returns `lastrowid`.
- `insert_response_log(cursor, invoice_number, request_url, http_status_code, is_success, response_message, response_body, error_message=None, invoice_process_uuid=None) -> int` —
  writes one row to `invoice_response_log`.
- `upsert_invoice_summary(cursor, record, log_id, invoice_process_uuid, ap_payment_file_detail_id) -> int` —
  maps + upserts into `invoice_summary` keyed on `invoice_id`.
- `upsert_invoice_detail(cursor, record, log_id) -> int` — maps + upserts into
  `invoice_detail` keyed on `invoice_id`.
- `insert_invoice_line_detail(cursor, detail_id, service_total_count) -> int`
- `insert_invoice_service(cursor, line_detail_id, service_record) -> int`
- `insert_invoice_charge(cursor, service_pk, charge_record) -> int`
- `update_ap_invoice_status(cursor, invoice_number, api_status, response_obj, response_status_code) -> None`
- `store_invoice_record(cursor, record, log_id, invoice_process_uuid, ap_payment_file_detail_id) -> None` —
  orchestrates one full record: summary → detail → (clear old nested rows) →
  line_detail → service → charge.

### `scripts/sync_payment_files.py`
- `_fetch_all_pages(call, api_label) -> list` — calls `call(page)` (a
  `requests.get` wrapper) starting at page 1, following `data.totalPages`
  until every page's `data.records` has been collected; raises `RuntimeError`
  if `payload.success` is falsy for any page.
- `sync_payment_files(cursor, cfg, token, interface_id) -> list[int]` —
  Step 2a of the pipeline (see §1). Calls the Get Payment Batches API over
  `[today - GetPaymentBatches.LookbackDays, today]` (UTC), skips any
  `paymentFileId` already in `ap_payment_file_details` for this interface, and
  for each new one: inserts `ap_payment_file_details` (`insert_payment_file`)
  + the raw record (`insert_batch_details`), then calls the Get Invoice List
  API for that `paymentFileId`, inserts each `invoiceAPBatchDetails[]` entry
  into `ap_batch_invoice_details` (+ its `allocationValues[]`/`custom[]` into
  their child tables) unconditionally, and inserts only the invoice numbers
  not already stored into `ap_invoices`. Returns the new
  `ap_payment_file_details.id` values (informational — the next step re-queries
  by status, so this return value isn't required for the pipeline to pick them up).

### `scripts/process_invoices.py` — **main entry point**

- `process_invoice(cursor, api_cfg, token, invoice_number, invoice_process_uuid, ap_payment_file_detail_id) -> str` —
  calls the Get Invoice API, logs the raw response, updates `ap_invoices`, and
  — only on `SUCCESS` — persists every record via `store_invoice_record`.
  Returns `SUCCESS` / `PENDING` / `FAILED` (see §6).
- `process_payment_file(conn, cursor, cfg, token, payment_file: dict) -> None` —
  runs one open batch end to end: `create_process_log`, loop
  `process_invoice()` over every invoice under that payment file (committing
  after each), generate the run-scoped CSV export, upload to SFTP, then send
  **either** the success email (only if every invoice succeeded) **or** the
  failure notification (if any invoice came back `FAILED` — with a summary
  error message naming the failure count — even though nothing raised an
  exception), before marking `ap_payment_file_details` accordingly. If an
  actual exception is raised anywhere in that sequence (including
  `create_process_log` itself), it's logged first — before any cleanup is
  attempted — then `conn.rollback()`, the `Failure` status update, and the
  failure email are each attempted independently (one failing doesn't skip or
  hide the others, or the original error). Either way, `process_payment_file`
  never re-raises, so the run continues to the next payment file rather than
  aborting the whole invocation.
- `main(interface_id: int | None = None) -> None` — if `interface_id` isn't
  passed in directly (e.g. from Airflow), parses it from `--interface-id` via
  argparse. Loads config and sets up logging (a failure at this exact point is
  printed to stderr, since the log file depends on the config that just failed
  to load); opens the DB connection (logged and re-raised on failure);
  authenticates *after* the `interfaceconfiguration` overlay is applied (so
  the right interface's credentials are used); calls `sync_payment_files()`
  (Step 2a — pulls any new payment files + invoice numbers from the upstream
  API, see below) and commits — this whole setup phase, up to and including
  the open-payment-files query, is wrapped so any failure is logged with full
  context before re-raising, since a failure here means no payment file can be
  processed at all; then runs `process_payment_file()` for each open payment
  file found (including any just inserted by `sync_payment_files()`).
  **This is the function to run/schedule** — invoked directly via
  `python scripts/process_invoices.py --interface-id <id>` or by the Airflow
  DAG (`dags/invoice_sync_dag.py`).

### `scripts/auth_client.py`
- `authenticate(cfg: InvoiceApiConfig) -> str` — fails fast with `RuntimeError`
  if `client_api_key`/`login_user_name`/`password` aren't all set (rather than
  sending blank credentials to the real API), otherwise POSTs
  `loginUserName`/`password` with the `ClientApiKey` header to the
  Authenticate endpoint and returns `data.accessToken`. Also raises
  `RuntimeError` if `success` is false or no token is returned. Logs the
  request URL/username before calling, and the failure reason on rejection.

### `scripts/invoice_client.py`
- `get_invoice(cfg: InvoiceApiConfig, token: str, invoice_number: str) -> requests.Response` —
  calls `GET {BaseUri}/api/v2/invoices` with `invoiceNumber`, `invoiceStatus`,
  `page`, `pageSize`, `sortBy`, `sortOrder`, `expand`, `export` query params and
  a `Bearer` auth header. Returns the raw `requests.Response` (caller decides
  how to handle non-2xx / bad JSON).
- `get_payment_batches(cfg, token, from_date, to_date, page=1) -> requests.Response` —
  calls `GET {BaseUri}{GetPaymentBatches.Endpoint}` (`/invoices/invoiceAPBatches`)
  with `fromDate`, `toDate`, `page`, `pageSize`, `sortBy`, `sortOrder`, `export`
  query params and a `Bearer` auth header.
- `get_invoice_list(cfg, token, payment_file_id, page=1) -> requests.Response` —
  calls `GET {BaseUri}{GetInvoiceList.Endpoint}` (`/invoices/invoiceAPBatchesDetails`)
  with `paymentFileId`, `page`, `pageSize`, `sortBy`, `sortOrder`, `expand`,
  `export` query params and a `Bearer` auth header.

### `scripts/fetch_ap_invoices.py` (standalone utility, not part of the pipeline)
- `fetch_ap_invoices() -> pd.DataFrame` — ad hoc read of `ap_invoices` via SQLAlchemy.

### `scripts/export_invoices_csv.py`
- `get_engine(cfg: MySqlConfig)` — SQLAlchemy engine (password URL-encoded).
- `build_export_filename(cfg, timestamp=None, suffix=None) -> str` — builds the
  CSV file name: `Output.FileName`'s base + optional `_<suffix>` (the payment
  file's batch name, sanitized) + `_<ddMMyyyy_hhmmss>` + extension, prefixed
  with `Job.OutputPrefix` + `_` when set (sourced from
  `interfaceconfiguration.InterfaceName` for whichever `--interface-id` is
  running -- see §4).
- `resolve_output_path(cfg, filename=None) -> str` — resolves `Output.Folder`
  into an absolute path, creating it if needed.
- `build_invoice_export(engine, tables, invoice_process_uuid=None) -> pd.DataFrame` —
  driven entirely by `Output.Tables`. When `invoice_process_uuid` is given, the
  base table's query is wrapped in `SELECT * FROM (<query>) AS scoped_base
  WHERE invoice_process_uuid = %(invoice_process_uuid)s` before the rest of
  the tables are left-joined on — everything downstream inherits the scoping
  through `invoice_id`. Without it, the base table is read unfiltered (used by
  `python scripts/export_invoices_csv.py` standalone).
- `export_invoices_csv(cfg=None, invoice_process_uuid=None, filename_suffix=None) -> str` —
  runs the join and writes it via `DataFrame.to_csv(index=False)`; returns the
  path written.

### `scripts/delivery.py`
- `upload_to_sftp(cfg: SftpConfig, local_path, filename) -> str` — opens a
  `paramiko` SFTP connection and puts `local_path` at
  `Sftp.RemoteDirectory/<filename>`. Raises `RuntimeError` up front if
  `Sftp.Host`/`Username`/`Password` are blank (unconfigured for this
  interface) or `Username`/`Password` still contain an unexpanded `${...}`
  placeholder, rather than letting paramiko fail with a less diagnosable error.
- `send_success_email(cfg: EmailConfig, filename, output_path) -> None` —
  formats `Email.Subject`/`Body` with `{filename}`/`{upload_time}`, attaches
  `output_path` when `Email.Attachment.Enabled`, sends via `Email.Smtp.*`.
  No-ops if `Email.Enabled` is false.
- `send_failure_email(cfg: EmailConfig, filename, error: Exception) -> None` —
  formats `Email.FailureNotification.Subject`/`Body` with `{filename}`,
  `{failure_time}`, `{error_message}`. No-ops if
  `Email.FailureNotification.Enabled` is false.

### `dags/invoice_sync_dag.py`
- Adds `scripts/` to `sys.path`, imports `process_invoices.main` as
  `run_invoice_sync`.
- `INTERFACE_ID = 1` — the `interfaceconfiguration.InterfaceId` this DAG
  processes; add another DAG (or parameterize this one further) for additional
  interfaces.
- Defines DAG `invoice_sync_dag` (`schedule_interval="@daily"`, `catchup=False`)
  with a single `PythonOperator` task calling
  `process_invoices.main(interface_id=INTERFACE_ID)`.

## 6. Status Derivation Logic

**Per invoice** — `process_invoice()` classifies the API response as:

| Condition | `api_status` |
|---|---|
| HTTP not OK, or JSON missing, or `payload.success` is false | `FAILED` |
| `success` true but `data.records` is empty | `PENDING` |
| `success` true and `data.records` has at least one record | `SUCCESS` |

Only on `SUCCESS` are the nested `invoice_summary` / `invoice_detail` / line
item rows written; `FAILED` and `PENDING` still update `ap_invoices` and log
the raw response, but skip the detail tables.

**Per payment-file batch** — `process_payment_file()` sets
`ap_payment_file_details.ap_batch_status` once every invoice in the batch has
been attempted:

| Condition | `ap_batch_status` | Email sent |
|---|---|---|
| No invoice in the batch came back `FAILED`, and export/SFTP/email all succeeded | `Success` | success email |
| At least one invoice `FAILED` (a handled status, not an exception) — export and SFTP upload still run for whatever succeeded | `Failure` | failure notification (names the failure count), **not** the success email |
| An exception occurred anywhere in the batch (process log, export, SFTP, or an unhandled error mid-loop) | `Failure` | failure notification, best-effort (its own failure is logged, not raised) |

A batch marked `Failure` is not automatically retried — flip its
`ap_batch_status` back to `'New'` to have the next run pick it up again.

## 7. Execution Steps

### 7.1 Prerequisites
- Python 3.12+
- MySQL Server with the `airflow` database, containing at least one active
  `interfaceconfiguration` row
- Network access to that interface's Invoice API `BaseUri` (this now includes
  the Get Payment Batches / Get Invoice List endpoints, not just Authenticate
  and Get Invoice), SFTP host, and SMTP host
- Either at least one `ap_payment_file_details` row with `ap_batch_status =
  'New'` already present (with matching `ap_invoices` rows,
  `ap_paymentfile_id` = that payment file's `id`), **or** the upstream API
  actually has new payment-file batches to return for the configured
  `GetPaymentBatches.LookbackDays` window — Step 2a (§1) populates both tables
  automatically from the API on every run, so a fresh interface with no rows
  yet will still process anything the API returns

### 7.2 Install dependencies
```bash
python -m pip install -r requirements.txt
```

### 7.3 Create / migrate the database schema
Fresh database:
```bash
mysql -h localhost -u sa -p airflow < sql/create_tables.sql
```
Database that already has `interfaceconfiguration`, `ap_payment_file_details`,
`ap_invoices_process_log`, `invoice_summary` in their older shape:
```bash
mysql -h localhost -u sa -p airflow < sql/migrate_payment_file_processing.sql
```
Database already running this pipeline but from before the payment-file sync
(§1 Step 2a) was added — run the standalone script for just the four new
tables (`ap_batch_details`, `ap_batch_invoice_details`,
`ap_batch_invoice_allocation_values`, `ap_batch_invoice_custom`); re-running
the full `create_tables.sql` also works (`CREATE TABLE IF NOT EXISTS` leaves
everything else untouched) but this is faster and more targeted:
```bash
mysql -h localhost -u sa -p airflow < sql/create_batch_detail_tables.sql
```

### 7.4 Configure credentials
Populate the `interfaceconfiguration` row for the interface you're running
(`SFTP_*`, `SMTP_*`, `Platform_UserId`/`Platform_Password`/`Platform_AppAuthKey`
for Invoice API auth, `Platform_InstanceUrl` for the base URI, `Email_*`). Any
column left `NULL` falls back to `config/appsettings.yml`'s `Sftp`/`Email`/
`InvoiceApi.Authentication` blocks if present there. Note: these secret
columns are **plaintext today** — encrypting them at rest is a separate,
not-yet-scheduled follow-up.

### 7.5 Run the pipeline directly
```bash
python scripts/process_invoices.py --interface-id 1
```
Runs the flow in §1: loads that interface's config, authenticates, syncs new
payment files + invoice numbers from the upstream API (`sync_payment_files()`
— Get Payment Batches → `ap_payment_file_details`/`ap_batch_details`, Get
Invoice List → `ap_invoices`/`ap_batch_invoice_details` + its child tables),
finds every `'New'` payment file for that interface (including any just
synced), and for each one — pulls its invoices, creates a process-log/UUID,
processes every invoice (Get Invoice API → `invoice_response_log` →
`ap_invoices` → detail tables), generates a UUID-scoped CSV export, uploads it
to SFTP, sends the success or failure email depending on whether any invoice
failed (see §6), and marks the batch `Success`/`Failure` accordingly.

Every run prints progress to the terminal **and** writes the same lines to a
fresh timestamped file at `logs/process_invoices_<YYYYMMDD_HHMMSS>.log`. If a
run appears to succeed but no payment files were processed, check that no
`ap_payment_file_details` row has `ap_batch_status = 'New'` for the
`--interface-id` given — that's logged explicitly (`"found 0 open ('New')
payment file(s)"`).

### 7.6 Run the pipeline via Airflow
Copy or symlink `dags/invoice_sync_dag.py` (and the `scripts/` + `config/`
folders it depends on) into your Airflow deployment's `dags/` folder, or point
`dags_folder` at this project's `dags/` directory. Adjust `INTERFACE_ID` in
`invoice_sync_dag.py` for the interface that DAG should run. `apache-airflow`
must be installed in that environment (intentionally not in this project's
`requirements.txt`).

### 7.7 Ad hoc data inspection
```bash
python scripts/fetch_ap_invoices.py
```
Prints the current contents of `ap_invoices` (filtered to `ap_paymentfile_id =
1001` in the current query — edit `QUERY` in `scripts/fetch_ap_invoices.py` as
needed).

### 7.8 Export all invoice data to CSV standalone (no run scoping)
```bash
python scripts/export_invoices_csv.py
```
`process_invoices.py` already generates a scoped export per payment file
(§7.5), so this is only needed to regenerate an **unscoped** CSV covering the
entire `invoice_summary` table's history — e.g. after manually editing
`Output.Tables`, or for ad hoc reporting.

## 8. Technical Notes

- **Config resolution order**: `interfaceconfiguration` (DB, per `--interface-id`)
  overlays `config/appsettings.yml` (fallback defaults) — see §4. MySQL
  connection settings are the one exception: they must stay in
  `appsettings.yml`/environment, since the pipeline needs them just to reach
  the database that `interfaceconfiguration` lives in.
- **DB access pattern**: `scripts/process_invoices.py` uses a raw
  `mysql.connector` connection/cursor (not SQLAlchemy) so it can rely on
  `cursor.lastrowid` to chain auto-increment IDs across inserts within one
  transaction. `scripts/fetch_ap_invoices.py` and
  `scripts/export_invoices_csv.py` use SQLAlchemy + pandas for reads.
- **Logging**: `scripts/logging_config.py::setup_logging()` configures
  Python's root logger once at the top of `process_invoices.py::main()` with
  a `FileHandler` (one fresh timestamped file per run) and a `StreamHandler`
  (console). Every module logs via `logging.getLogger(__name__)`.
  `mysql.connector`/`urllib3` noise is capped at `WARNING`. `process_invoices.py`
  logs every phase at `INFO` (bracketed `=== ... ===` lines for run/payment-file
  start and end, step-numbered lines matching §1), so scanning the log file
  tells you exactly which payment file and which step failed; `repository.py`
  additionally logs a `DEBUG`-level trace of every DB read/write (row counts,
  the generated `invoice_process_uuid`, status transitions) — set
  `Logging.Level: DEBUG` to see those.
- **Failure handling order**: wherever a batch fails, the original exception
  is always logged (`logger.exception`, full traceback) *before* any cleanup
  is attempted, and every cleanup step (`conn.rollback()`, the `Failure`
  status update, the failure email) is wrapped independently — so a
  broken-connection `rollback()` failure, for instance, can never suppress the
  log line for the error that actually caused the batch to fail.
- **Airflow integration**: `dags/invoice_sync_dag.py` inserts `scripts/` onto
  `sys.path` at import time and calls `process_invoices.main(interface_id=...)`
  directly from a `PythonOperator` — `main()` accepts `interface_id` as a
  keyword argument specifically so it can be called this way without going
  through `argparse` (which would otherwise try to parse Airflow's own process
  arguments and fail).
- **Password with special characters**: MySQL passwords containing `@` (e.g.
  `Augday@11`) must be URL-encoded (`urllib.parse.quote_plus`) when building a
  SQLAlchemy connection string. `mysql.connector.connect(**kwargs)` doesn't
  have this issue since it takes the password as a discrete argument.
- **Field mapping / typos preserved**: `config/field_maps.yml` intentionally
  preserves a spelling inconsistency present in the source API
  (`invoiceApporvedNotapporvedBy` → `invoice_apporved_notapporved_by`).
- **ISO 8601 date conversion**: `scripts/field_maps.py::map_record()` detects
  ISO 8601 date strings via regex and converts them to naive `datetime`
  objects before insert (MySQL `DATETIME` columns reject the API's `Z`/offset
  suffix outright).
- **Payment-file sync window / pagination / dedupe** (`sync_payment_files.py`):
  the Get Payment Batches pull is windowed to `[today - LookbackDays, today]`
  (UTC, `GetPaymentBatches.LookbackDays` in `appsettings.yml`, default `1`) —
  widen it if a run could be delayed long enough to miss a batch created near
  the boundary. Both new APIs are paginated via `data.totalPages`, not just a
  single page like `get_invoice`. Dedup is by upstream id, not content: a
  `paymentFileId` already present in `ap_payment_file_details` for that
  interface is skipped entirely (its invoice list isn't re-pulled), and within
  a newly-pulled batch, only `invoiceNumber`s not already in `ap_invoices` for
  that payment file are inserted — but the raw-capture tables
  (`ap_batch_details`, `ap_batch_invoice_details` + its child tables) are only
  ever written once, at the same time as the first insert, so they can't
  accumulate duplicates either. There's currently no filter on
  `apPaymentFileStatus` — every batch the API returns in the date window is
  pulled in, regardless of its upstream status.
- **Not yet wired up**: `interfaceconfiguration.Platform_DB_*` /
  `Platform_DB_AP_Query` (a connection + templated query against a separate
  external database) both exist in the schema but aren't read by any script
  yet — they weren't part of the payment-file-scoped flow this README
  describes. Encrypting `interfaceconfiguration`'s plaintext secret columns is
  also not yet implemented.
- **Legacy tables retired**: `aprequestpaymentdetails` (`request_detail_id`,
  `request_id`, `payment_flie_id`, `ap_batch_name`) predated the Get Payment
  Batches API integration, had no `interface_id` column, and its payment-file
  ids didn't overlap with `ap_payment_file_details`'. Neither it nor
  `aprequestdetails` was ever read by any script in this repo (confirmed via
  full-repo search). `ap_payment_file_details` is now the single source of
  truth for payment-file batches — `sync_payment_files.py` populates it per
  `interface_id` directly from the upstream API's `fromDate`/`toDate` window
  (§1 Step 2a), which is the same information `aprequestpaymentdetails` used
  to hold, so no data migration was needed for either table.
  `aprequestpaymentdetails` was dropped 2026-09-12 via
  [`sql/drop_aprequestpaymentdetails.sql`](sql/drop_aprequestpaymentdetails.sql);
  `aprequestdetails` can be dropped the same way via
  [`sql/drop_aprequestdetails.sql`](sql/drop_aprequestdetails.sql).
- **Other potential data-shape risks (not yet hit, flagged for awareness)**:
  freeform text fields such as `reason`, `address`, `billing_street_address`,
  and `remit_street_address` are `VARCHAR(200)`–`VARCHAR(500)` in the DDL; if
  the live API ever returns longer values, MySQL will raise `Error 1406: Data
  too long for column`. Fix is a one-line `ALTER TABLE ... MODIFY COLUMN ...
  TEXT` for the affected column(s).
