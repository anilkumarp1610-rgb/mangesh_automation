# Function Execution Reference — Invoice Sync Pipeline

Step-by-step technical documentation of every Python function in the pipeline:
**call order**, **inputs**, **outputs / side effects**, and **dependencies**
(what each function calls, plus the external libraries / DB tables / APIs it
touches).

Entry point: [`scripts/process_invoices.py::main()`](../scripts/process_invoices.py).
Companion prose: [`README.md`](../README.md) §5–§6.

---

## 1. End-to-end call sequence

Numbers are the execution order for a single `main(interface_id=N)` invocation.
Indentation = call nesting. `× files` / `× invoices` = runs once per loop item.

| # | Function (module) | Called by | Purpose at this step |
|---|---|---|---|
| 1 | `main()` (process_invoices) | CLI / Airflow `PythonOperator` | Orchestrates the whole run for one interface |
| 2 | `load_config()` (config) | `main` | Load `appsettings.yml` → `AppConfig` (YAML defaults only) |
| 3 | `setup_logging()` (logging_config) | `main` | Configure root logger: 1 timestamped file + console |
| 4 | `get_connection()` (db) | `main` | Open raw `mysql.connector` connection + `dict` cursor |
| 5 | `load_interface_configuration()` (repository) | `main` | Read `interfaceconfiguration` row → dict of dotted overlay keys |
| 6 | `load_config(interface_values=…)` (config) | `main` | Rebuild `AppConfig` with DB row overlaid on YAML |
| 7 | `authenticate()` (auth_client) | `main` | POST Authenticate API → bearer `token` |
| 7.1 | `sync_payment_files()` (sync_payment_files) | `main` | Pull new payment-file batches + invoice numbers from the upstream API (see §1a) |
| 8 | `get_open_payment_files()` (repository) | `main` | `SELECT` `ap_payment_file_details` rows with status `New` (includes any just inserted by 7.1) |
| 9 | `process_payment_file()` (process_invoices) | `main` — **× files** | Run one batch end-to-end (never re-raises) |
| 9.1 | `start_batch_run()` (repository) | `process_payment_file` | Mint run UUID; `UPDATE` `ap_payment_file_details.invoice_process_uuid` |
| 9.2 | `get_invoice_numbers_for_payment_file()` (repository) | `process_payment_file` | Distinct `ap_invoice_number`s for this batch |
| 9.3 | `process_invoice()` (process_invoices) | `process_payment_file` — **× invoices** | One invoice: API call → log → status → detail rows |
| 9.3.1 | `get_invoice()` (invoice_client) | `process_invoice` | `GET` Invoice API for one `invoice_number` |
| 9.3.2 | `insert_response_log()` (repository) | `process_invoice` | `INSERT` `invoice_response_log` (raw JSON, HTTP status) |
| 9.3.3 | `update_ap_invoice_status()` (repository) | `process_invoice` | `UPDATE` `ap_invoices` with status + raw response |
| 9.3.4 | `store_invoice_record()` (repository) | `process_invoice` — **× records**, only on `SUCCESS` | Persist one nested API record |
| 9.3.4.a | `upsert_invoice_summary()` (repository) | `store_invoice_record` | `upsert` `invoice_summary` (key `invoice_id`) |
| 9.3.4.b | `upsert_invoice_detail()` (repository) | `store_invoice_record` | `upsert` `invoice_detail` (key `invoice_id`) |
| 9.3.4.c | `insert_invoice_line_detail()` (repository) | `store_invoice_record` — × `invoiceDetails` | `INSERT` `invoice_line_detail` |
| 9.3.4.d | `insert_invoice_service()` (repository) | `store_invoice_record` — × `invoiceServices` | `INSERT` `invoice_service` |
| 9.3.4.e | `insert_invoice_charge()` (repository) | `store_invoice_record` — × `invoiceCharges` | `INSERT` `invoice_charge` |
| 9.4 | `export_invoices_csv()` (export_invoices_csv) | `process_payment_file` | Build run-scoped CSV for this batch |
| 9.4.1 | `get_engine()` (export_invoices_csv) | `export_invoices_csv` | SQLAlchemy engine (password URL-encoded) |
| 9.4.2 | `build_invoice_export()` (export_invoices_csv) | `export_invoices_csv` | Join `Output.Tables`, scoped by `invoice_process_uuid` |
| 9.4.3 | `build_export_filename()` (export_invoices_csv) | `export_invoices_csv` | Compose `<prefix>_<base>_<suffix>_<ddMMyyyy_HHMMSS>.csv` |
| 9.4.4 | `resolve_output_path()` (export_invoices_csv) | `export_invoices_csv` | Absolute path under `Output.Folder` (mkdir) |
| 9.5 | `upload_to_sftp()` (delivery) | `process_payment_file` | `paramiko` SFTP `put` of the CSV |
| 9.6 | `send_success_email()` **or** `send_failure_email()` (delivery) | `process_payment_file` | Notify — success only if 0 `FAILED`; else failure |
| 9.6.x | `_send_message()` (delivery) | both email functions | Build `EmailMessage`, SMTP send (no-op if disabled) |
| 9.7 | `update_payment_file_status()` (repository) | `process_payment_file` | `UPDATE` `ap_payment_file_details` → `Success`/`Failure` |

Helpers `insert()` / `upsert()` (repository) are the low-level SQL builders
called by steps 9.1 and 9.3.2–9.3.4. `map_record()` / `_convert_value()`
(field_maps) are called inside every `upsert_invoice_*` / `insert_invoice_*` to
translate API camelCase → DB snake_case and coerce ISO-8601 dates.

---

## 1a. Payment-file sync — `scripts/sync_payment_files.py`

Runs once per `main()` invocation, right after authentication and before the
`ap_payment_file_details`/`New` query, so newly-pulled batches are picked up
by the same run.

| Function | Inputs | Output | Calls (internal) | External deps | Notes |
|---|---|---|---|---|---|
| `sync_payment_files(cursor, cfg, token, interface_id)` | live `cursor`; `cfg: AppConfig`; `token: str`; `interface_id: int` | `list[int]` — every `ap_payment_file_details.id` inserted this run | `_fetch_all_pages`, `get_payment_batches`, `insert_payment_file`, `get_invoice_list`, `insert_batch_invoice_detail`, `insert_batch_invoice_allocation_value`, `insert_batch_invoice_custom`, `insert_ap_invoice` | — | Date window: `[today - GetPaymentBatches.LookbackDays, today]` (UTC). No dedup: every batch the API returns gets a brand-new `ap_payment_file_details` row every run, even if its `paymentFileId` was already seen on a prior run — deliberate, since a batch's invoice list can grow or shrink on the vendor's side and the whole chain is cheaper to reprocess from a fresh id than to diff. Reprocessing is naturally bounded by the date window itself: once a batch ages out of `[today - LookbackDays, today]`, the API stops returning it |
| `_fetch_all_pages(call, api_label)` | `call: int -> requests.Response`; label for error messages | `list[dict]` — every `data.records` across all pages | — | `requests.Response.raise_for_status/json` | Loops `page=1..data.totalPages`; `RuntimeError` if `payload.success` is falsy |

`GET {BaseUri}{GetPaymentBatches.Endpoint}` (`/invoices/invoiceAPBatches`) returns
`data.records[].{paymentFileId, apBatchName, ...}` → one `ap_payment_file_details`
row each, holding both the pipeline-owned tracking columns
(`ap_batch_status='New'`, `processed_date`, `invoice_process_uuid`) and the
raw API record's fields (`client`, `ap_payment_file_status`, amounts, etc. —
via `insert_payment_file`, formerly split into a separate `ap_batch_details`
table). `GET {BaseUri}{GetInvoiceList.Endpoint}` (`/invoices/invoiceAPBatchesDetails?paymentFileId=...`)
returns `data.records[].invoiceAPBatchDetails[]` → one `ap_invoices` row per
distinct `invoiceNumber`, unconditionally (`insert_ap_invoice`), **plus**
the full raw `invoiceAPBatchDetails[]` entry (flat fields) → one
`ap_batch_invoice_details` row each, also unconditionally (`insert_batch_invoice_detail`)
— both keyed to the new `ap_payment_file_details.id` (not the upstream
`paymentFileId`). No existence check is needed for either: this
`ap_payment_file_details.id` is brand new, so nothing could already reference
it. Each entry's nested `allocationValues[]` / `custom[]`
arrays are further normalized into `ap_batch_invoice_allocation_values` /
`ap_batch_invoice_custom` child rows, keyed to that `ap_batch_invoice_details.id`
(`insert_batch_invoice_allocation_value`, `insert_batch_invoice_custom`) —
same nested-table shape as the invoice-detail chain in §1, not JSON blobs.

---

## 2. Orchestration functions — `scripts/process_invoices.py`

| Function | Inputs | Output | Calls (internal) | External deps | Side effects |
|---|---|---|---|---|---|
| `main(interface_id=None)` | `interface_id: int \| None`; if `None`, parsed from `--interface-id` | `None` (raises on setup failure) | `load_config`, `setup_logging`, `get_connection`, `load_interface_configuration`, `authenticate`, `get_open_payment_files`, `process_payment_file` | `argparse`, `mysql.connector` (cursor), `traceback` | Opens/closes DB conn + cursor; configures root logger; drives per-file loop |
| `process_payment_file(conn, cursor, cfg, token, payment_file)` | live `conn`, `cursor`; `cfg: AppConfig`; `token: str`; `payment_file: dict` (row from step 8) | `None` — **never re-raises** | `start_batch_run`, `get_invoice_numbers_for_payment_file`, `process_invoice`, `export_invoices_csv`, `upload_to_sftp`, `send_success_email`, `send_failure_email`, `update_payment_file_status` | `os.path.basename`, `re` (filename sanitize) | `conn.commit()` after each invoice; on error: `conn.rollback()` + `Failure` update + failure email, each independently guarded |
| `process_invoice(cursor, api_cfg, token, invoice_number, invoice_process_uuid, ap_payment_file_detail_id)` | `cursor`; `api_cfg: InvoiceApiConfig`; `token: str`; `invoice_number: str`; `invoice_process_uuid: str`; `ap_payment_file_detail_id: int` | `str` — `"SUCCESS"` \| `"PENDING"` \| `"FAILED"` | `get_invoice`, `insert_response_log`, `update_ap_invoice_status`, `store_invoice_record` | `requests.Response.json()` | Writes `invoice_response_log`, `ap_invoices`, and (SUCCESS only) all detail tables |

**Status derivation inside `process_invoice`:**

| Condition | Return | Detail tables written? |
|---|---|---|
| HTTP not OK **or** body not JSON **or** `payload.success` falsy | `FAILED` | No |
| `success` true **and** `data.records` empty | `PENDING` | No |
| `success` true **and** `data.records` non-empty | `SUCCESS` | Yes — one `store_invoice_record` per record |

---

## 3. Configuration & setup — `config.py`, `logging_config.py`, `field_maps.py`, `db.py`

| Function | Inputs | Output | Calls (internal) | External deps | Notes |
|---|---|---|---|---|---|
| `load_config(path=APPSETTINGS_PATH, interface_values=None)` | YAML path; optional `dict` of dotted keys → values | `AppConfig` dataclass | `_expand_env`, `_set_nested` | `yaml.safe_load`, `os`, `re` | `interface_values` set into raw dict **before** dataclasses built → DB wins over YAML |
| `_expand_env(value)` | `str` / `dict` / `list` / scalar | same shape, `${VAR}` → `os.environ` | recurses | `os.environ`, `re.sub` | Unresolved `${…}` left as literal |
| `_set_nested(raw, key, value)` | raw dict; `"a.b.c"` key; value | `None` (mutates `raw`) | — | — | Creates intermediate dicts via `setdefault` |
| `setup_logging(cfg: LoggingConfig, run_name="process_invoices")` | logging config; run label | `str` — path of the log file | — | `logging`, `os.makedirs`, `datetime` | Clears existing handlers; adds `FileHandler` + `StreamHandler`; caps `mysql.connector`/`urllib3` at WARNING |
| `map_record(record: dict, field_map: dict)` | one API record; API→DB name map | `dict` of `db_col → converted value` | `_convert_value` | — | Missing API fields → `None` |
| `_convert_value(value)` | any | ISO-8601 str → naive `datetime`; else unchanged | — | `datetime.fromisoformat`, `re` | Strips `Z`/offset so MySQL `DATETIME` accepts it |
| `get_connection(cfg: MySqlConfig)` | MySQL config | `MySQLConnection` | — | `mysql.connector.connect` | Password passed as discrete kwarg (no URL-encoding needed) |

Module-load side effect: `field_maps.py` reads `config/field_maps.yml` at import
and exposes `SUMMARY_FIELD_MAP`, `DETAIL_FIELD_MAP`, `SERVICE_FIELD_MAP`,
`CHARGE_FIELD_MAP`.

---

## 4. API clients — `auth_client.py`, `invoice_client.py`

| Function | Inputs | Output | External deps | Failure modes |
|---|---|---|---|---|
| `authenticate(cfg: InvoiceApiConfig)` | `cfg.authentication` (`client_api_key`, `login_user_name`, `password`), `cfg.base_uri` | `str` — `data.accessToken` | `requests.post` (30s timeout), `logging` | `RuntimeError` if any credential blank; `raise_for_status()`; `RuntimeError` if `success` false or no token |
| `get_invoice(cfg: InvoiceApiConfig, token, invoice_number)` | `cfg.base_uri`, `cfg.get_invoice` (`endpoint`, `invoice_status`, `page_size`, `expand`); `token: str`; `invoice_number: str` | raw `requests.Response` | `requests.get` (60s timeout) | None raised — caller inspects `.ok` / `.json()` |
| `get_payment_batches(cfg, token, from_date, to_date, page=1)` | `cfg.get_payment_batches` (`endpoint`, `page_size`); `from_date`/`to_date: str` (`YYYY-MM-DD`); `page: int` | raw `requests.Response` | `requests.get` (60s timeout) | None raised — caller (`_fetch_all_pages`) calls `raise_for_status()`/`.json()` |
| `get_invoice_list(cfg, token, payment_file_id, page=1)` | `cfg.get_invoice_list` (`endpoint`, `page_size`, `expand`); `payment_file_id`; `page: int` | raw `requests.Response` | `requests.get` (60s timeout) | None raised — caller (`_fetch_all_pages`) calls `raise_for_status()`/`.json()` |

`get_invoice` request: `GET {base_uri}{endpoint}` with query params
`invoiceStatus, invoiceNumber, page=1, pageSize, sortBy=createdDate,
sortOrder=desc, expand, export=false` and header `Authorization: Bearer <token>`.

`get_payment_batches` request: `GET {base_uri}{endpoint}` with query params
`fromDate, toDate, page, pageSize, sortBy=createdDate, sortOrder=desc,
export=false` and header `Authorization: Bearer <token>`.

`get_invoice_list` request: `GET {base_uri}{endpoint}` with query params
`paymentFileId, page, pageSize, sortBy=createdDate, sortOrder=desc, expand,
export=false` and header `Authorization: Bearer <token>`.

---

## 5. Data access — `scripts/repository.py`

### 5.1 Reads

| Function | Inputs | Output | SQL / table | Notes |
|---|---|---|---|---|
| `load_interface_configuration(cursor, interface_id)` | `cursor`, `interface_id: int` | `dict` — dotted key → value | `SELECT * FROM interfaceconfiguration WHERE InterfaceId=%s AND IsActive=1` | `ValueError` if no active row; skips `NULL`/empty columns; bools via `bool()`; recipient lists via `_parse_recipient_list` |
| `get_open_payment_files(cursor, interface_id)` | `cursor`, `interface_id: int` | `list[dict]` — payment-file rows | `SELECT id, ap_batch_name, ap_batch_payment_file_id, interface_id, ap_batch_status FROM ap_payment_file_details WHERE interface_id=%s AND ap_batch_status='New'` | Drives the step-9 loop |
| `get_invoice_numbers_for_payment_file(cursor, payment_file_detail_id)` | `cursor`, `payment_file_detail_id: int` | `list[str]` | `SELECT DISTINCT ap_invoice_number FROM ap_invoices WHERE ap_paymentfile_id=%s AND ap_invoice_number IS NOT NULL` | Handles dict or tuple rows; drives the per-invoice loop in step 10.2 |
| `_parse_recipient_list(value)` | `str` | `list[str]` | — | JSON array if starts with `[`, else split on `,`/`;` |

### 5.2 Writes

| Function | Inputs | Output | Target table | Calls |
|---|---|---|---|---|
| `start_batch_run(cursor, payment_file_detail_id)` | `cursor`, `payment_file_detail_id: int` | `str` — fresh `process_uuid` | `ap_payment_file_details` (`UPDATE ... SET invoice_process_uuid`) | `uuid.uuid4` |
| `insert_response_log(cursor, invoice_number, request_url, http_status_code, is_success, response_message, response_body, error_message=None, invoice_process_uuid=None)` | per-call API result fields | `int` — new `log_id` | `invoice_response_log` | `json.dumps`, `insert` |
| `update_ap_invoice_status(cursor, invoice_number, api_status, response_obj, response_status_code)` | status str + raw payload + HTTP code | `None` | `ap_invoices` (`UPDATE ... WHERE ap_invoice_number=%s`) | `json.dumps` |
| `store_invoice_record(cursor, record, log_id, invoice_process_uuid, ap_payment_file_detail_id)` | one API `record` dict + FK context | `None` | orchestrates 5 tables | `upsert_invoice_summary`, `upsert_invoice_detail`, `DELETE invoice_line_detail`, `insert_invoice_line_detail`, `insert_invoice_service`, `insert_invoice_charge` |
| `upsert_invoice_summary(cursor, record, log_id, invoice_process_uuid, ap_payment_file_detail_id)` | record + FK context | `int` — `invoice_id` row PK | `invoice_summary` (unique `invoice_id`) | `map_record(SUMMARY_FIELD_MAP)`, `upsert` |
| `upsert_invoice_detail(cursor, record, log_id)` | record + `log_id` | `int` — `detail_id` | `invoice_detail` (unique `invoice_id`) | `map_record(DETAIL_FIELD_MAP)`, `upsert` |
| `insert_invoice_line_detail(cursor, detail_id, service_total_count)` | `detail_id: int`, count | `int` — `line_detail_id` | `invoice_line_detail` | `insert` |
| `insert_invoice_service(cursor, line_detail_id, service_record)` | `line_detail_id: int`, service dict | `int` — `service_pk` | `invoice_service` | `map_record(SERVICE_FIELD_MAP)`, `insert` |
| `insert_invoice_charge(cursor, service_pk, charge_record)` | `service_pk: int`, charge dict | `int` — row PK | `invoice_charge` | `map_record(CHARGE_FIELD_MAP)`, `insert` |
| `update_payment_file_status(cursor, payment_file_detail_id, status)` | `status: str` | `None` | `ap_payment_file_details` (`ap_batch_status`, `processed_date=now`) | `datetime` |
| `insert_payment_file(cursor, interface_id, payment_file_id, batch_name, record)` | `interface_id: int`; upstream `payment_file_id`; `batch_name: str`; raw Get Payment Batches API `record` dict | `int` — new `ap_payment_file_details.id` | `ap_payment_file_details` (`ap_batch_status` set to `'New'`, plus `map_record(BATCH_DETAILS_FIELD_MAP)`'s fields on the same row — formerly a separate `ap_batch_details` table, merged in) | `map_record`, `insert` |
| `insert_ap_invoice(cursor, payment_file_detail_id, invoice_number)` | `payment_file_detail_id: int`; `invoice_number: str` | `int` — new `ap_invoice_id` | `ap_invoices` | `insert` |
| `insert_batch_invoice_detail(cursor, payment_file_detail_id, batch_name, detail_record)` | `payment_file_detail_id: int`; `batch_name: str`; raw `invoiceAPBatchDetails[]` entry (flat fields only) | `int` — new `ap_batch_invoice_details.id` | `ap_batch_invoice_details` | `map_record(BATCH_INVOICE_DETAIL_FIELD_MAP)`, `insert` |
| `insert_batch_invoice_allocation_value(cursor, batch_invoice_detail_id, allocation_record)` | `batch_invoice_detail_id: int`; one `allocationValues[]` entry | `int` — new row id | `ap_batch_invoice_allocation_values` | `map_record(BATCH_INVOICE_ALLOCATION_VALUE_FIELD_MAP)`, `insert` |
| `insert_batch_invoice_custom(cursor, batch_invoice_detail_id, custom_record)` | `batch_invoice_detail_id: int`; one `custom[]` entry | `int` — new row id | `ap_batch_invoice_custom` | `map_record(BATCH_INVOICE_CUSTOM_FIELD_MAP)`, `insert` |

### 5.3 Low-level SQL builders

| Function | Inputs | Output | Behaviour |
|---|---|---|---|
| `insert(cursor, table, data: dict)` | table name, column→value dict | `int` — `cursor.lastrowid` | `INSERT INTO \`table\` (cols) VALUES (%s…)` |
| `upsert(cursor, table, data: dict, unique_cols=None)` | + list of key columns to exclude from the UPDATE clause | `int` — `cursor.lastrowid` | `INSERT … ON DUPLICATE KEY UPDATE col=VALUES(col)` for non-unique cols |

All chained via `cursor.lastrowid` within one transaction — the reason
`process_invoices.py` uses raw `mysql.connector` rather than SQLAlchemy.

---

## 6. CSV export — `scripts/export_invoices_csv.py`

| Function | Inputs | Output | Calls (internal) | External deps |
|---|---|---|---|---|
| `export_invoices_csv(cfg=None, invoice_process_uuid=None, filename_suffix=None)` | optional `AppConfig`; run UUID for scoping; batch-name suffix | `str` — path of the written CSV | `load_config` (if `cfg` None), `get_engine`, `build_invoice_export`, `resolve_output_path`, `build_export_filename` | `pandas.DataFrame.to_csv(index=False)` |
| `get_engine(cfg: MySqlConfig)` | MySQL config | SQLAlchemy `Engine` | — | `sqlalchemy.create_engine`, `urllib.parse.quote_plus` (password `@` safe) |
| `build_invoice_export(engine, tables: list[ExportTableConfig], invoice_process_uuid=None)` | engine; `Output.Tables`; optional UUID | `pandas.DataFrame` (joined) | — | `pandas.read_sql` | first table = base (`invoice_summary`); if UUID given, base query wrapped `SELECT * FROM (<q>) AS scoped_base WHERE invoice_process_uuid=%(…)s`; rest `LEFT JOIN` on each `JoinOn`; `ValueError` if list empty or a non-base entry lacks `JoinOn` |
| `build_export_filename(cfg: AppConfig, timestamp=None, suffix=None)` | config; optional ts; optional suffix | `str` filename | — | `os.path.splitext`, `datetime.strftime('%d%m%Y_%H%M%S')` | `<Job.OutputPrefix>_<base>[_<suffix>]_<ddMMyyyy_HHMMSS><ext or .csv>` |
| `resolve_output_path(cfg: AppConfig, filename=None)` | config; optional filename | `str` absolute path | — | `os.path.isabs/join`, `os.makedirs(exist_ok=True)` | relative `Output.Folder` resolved against project root |

---

## 7. Delivery — `scripts/delivery.py`

| Function | Inputs | Output | External deps | Guard / no-op condition |
|---|---|---|---|---|
| `upload_to_sftp(cfg: SftpConfig, local_path, filename)` | SFTP config; local file path; remote filename | `str` — remote path written | `paramiko.Transport`, `paramiko.SFTPClient.put`, `posixpath.join` | `RuntimeError` if host/username/password blank or still contain `${…}` |
| `send_success_email(cfg: EmailConfig, filename, output_path)` | email config; display filename; CSV path | `None` | via `_send_message` | attaches file only if `Email.Attachment.Enabled`; formats `{filename}`, `{upload_time}` |
| `send_failure_email(cfg: EmailConfig, filename, error: Exception)` | email config; filename; the exception | `None` | via `_send_message` | returns immediately if `Email.FailureNotification.Enabled` false; formats `{filename}`, `{failure_time}`, `{error_message}` |
| `_send_message(cfg, subject, body, recipients_to, recipients_cc, attachment_path=None, attachment_name=None)` | composed message parts | `None` | `smtplib.SMTP`, `email.message.EmailMessage`, `datetime` | returns immediately if `cfg.enabled` false; `RuntimeError` if SMTP creds contain `${…}`; `starttls()` if `use_tls`; `login()` only if username set |

---

## 8. Standalone utilities (not called by `main`)

| Function (module) | Inputs | Output | External deps | Purpose |
|---|---|---|---|---|
| `fetch_ap_invoices()` (fetch_ap_invoices) | none — module-level `QUERY`, DB consts | `pandas.DataFrame` | `sqlalchemy.create_engine`, `pandas.read_sql`, `urllib.parse.quote_plus` | Ad-hoc dump of `ap_invoices` (`ap_paymentfile_id = 1001`); `python scripts/fetch_ap_invoices.py` |
| `export_invoices_csv()` (export_invoices_csv) | called with no args | `str` path | see §6 | Unscoped full-history CSV; `python scripts/export_invoices_csv.py` |

---

## 9. Airflow DAG wrappers — `dags/`

All three prepend `scripts/` to `sys.path`, import
`process_invoices.main as run_invoice_sync`, and expose it as a `PythonOperator`
(`schedule_interval="@daily"`, `catchup=False`, `retries=1`).

| File | Interface-id source | Task callable(s) | Extra deps | Flow |
|---|---|---|---|---|
| `invoice_sync_dag.py` | module constant `INTERFACE_ID = 1` | `run_invoice_sync` via `op_kwargs={"interface_id": 1}` | — | single task `run_invoice_sync` |
| `invoice_sync_parametrized_dag.py` | Airflow Variable `invoice_sync_interface_id` (default 1) | `run_invoice_sync_task(**context)` → `run_invoice_sync(interface_id=…)` | `airflow.models.Variable` | single task; `ValueError` if Variable not an int |
| `invoice_execution_dag.py` | Airflow Variable `invoice_execution_interface_id` (default 1), via `_resolve_interface_id()` | `preflight(**context)` → `run(**context)` | `Variable`, `load_config`, `get_connection`, `load_interface_configuration` | `preflight >> run_invoice_sync` — preflight fails fast on bad DB / missing interface row |

| DAG helper | Inputs | Output | Calls | Notes |
|---|---|---|---|---|
| `_resolve_interface_id()` (invoice_execution_dag) | — | `int` | `Variable.get` | `ValueError` on non-int |
| `preflight(**context)` (invoice_execution_dag) | Airflow context | `None` | `_resolve_interface_id`, `load_config`, `get_connection`, `load_interface_configuration` | Opens + closes its own DB connection; raises `ValueError` if no active interface row |
| `run(**context)` / `run_invoice_sync_task(**context)` | Airflow context | `None` | `_resolve_interface_id` (or `Variable.get`), `run_invoice_sync` | Thin wrapper around `main(interface_id=…)` |

---

## 10. External dependency map

| Dependency | Used by |
|---|---|
| `mysql-connector-python` | `db.get_connection`, all of `repository.py`, `process_invoices.py` cursor, `invoice_execution_dag.preflight` |
| `sqlalchemy` | `export_invoices_csv.get_engine`, `fetch_ap_invoices` |
| `pandas` | `export_invoices_csv.build_invoice_export` / `export_invoices_csv`, `fetch_ap_invoices` |
| `requests` | `auth_client.authenticate`, `invoice_client.get_invoice` |
| `pyyaml` | `config.load_config`, `field_maps` (module load) |
| `paramiko` | `delivery.upload_to_sftp` |
| `smtplib` / `email` (stdlib) | `delivery._send_message` |
| `apache-airflow` (not in `requirements.txt`) | `dags/*.py` only |
| Invoice API — `POST /api/v2/Authenticate` | `auth_client.authenticate` |
| Invoice API — `GET /api/v2/invoices` | `invoice_client.get_invoice` |
| Invoice API — `GET /invoices/invoiceAPBatches` | `invoice_client.get_payment_batches` |
| Invoice API — `GET /invoices/invoiceAPBatchesDetails` | `invoice_client.get_invoice_list` |
| SFTP server | `delivery.upload_to_sftp` |
| SMTP server | `delivery._send_message` |

### DB tables by access

| Table | Read by | Written by |
|---|---|---|
| `interfaceconfiguration` | `load_interface_configuration` | — |
| `ap_payment_file_details` | `get_open_payment_files` | `update_payment_file_status`, `insert_payment_file`, `start_batch_run` |
| `ap_invoices` | `get_invoice_numbers_for_payment_file`, `fetch_ap_invoices` | `update_ap_invoice_status`, `insert_ap_invoice` |
| `ap_batch_invoice_details` | export/reporting (raw `invoiceAPBatchDetails[]` flat fields per invoice line) | `insert_batch_invoice_detail` |
| `ap_batch_invoice_allocation_values` | export/reporting (`allocationValues[]` child rows) | `insert_batch_invoice_allocation_value` |
| `ap_batch_invoice_custom` | export/reporting (`custom[]` child rows) | `insert_batch_invoice_custom` |
| `invoice_response_log` | export join | `insert_response_log` |
| `invoice_summary` | export join (base, run-scoped) | `upsert_invoice_summary` |
| `invoice_detail` | export join | `upsert_invoice_detail` |
| `invoice_line_detail` | export join | `insert_invoice_line_detail` (+ `DELETE` in `store_invoice_record`) |
| `invoice_service` | export join | `insert_invoice_service` |
| `invoice_charge` | export join | `insert_invoice_charge` |
