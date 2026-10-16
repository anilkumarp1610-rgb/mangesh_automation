# Version History

One entry per commit, newest first: what changed **functionally** (behaviour a
user/operator sees) and **technically** (code, schema, config), plus anything
that must be done when deploying it. Versions are sequential per commit
(`1.<n>.0`); history before v1.1.0 is in `git log` only.

**Convention:** every commit adds one entry at the top, in the same commit as
the change, with the heading

    ## v1.<n>.0 — `pending` — YYYY-MM-DD

(the commit date). A commit can't contain its own id, so write `pending`; the
`.githooks/pre-commit` hook replaces it with the commit id when the **next**
commit is made, and blocks any commit that doesn't stage this file. Enable the
hook once per clone: `git config core.hooksPath .githooks`. Emergency skip:
`SKIP_VERSION_CHECK=1 git commit ...`. The commit message template
(`.gitmessage`, enabled with `git config commit.template .gitmessage`) shows
the same checklist in the editor.

**Checklist for every commit**

- [ ] New entry at the top: version, date, `pending`
- [ ] Functional, Technical, Deploy and Known limits filled in
- [ ] Anything under "Unreleased" that is in this commit moved into the entry
- [ ] New columns/tables: `create_tables.sql` and a re-runnable ALTER script
- [ ] Entry file staged (`git add docs/VERSION_HISTORY.md`)

---

## v1.5.0 — `pending` — 2026-10-16
**Output type (CSV / Excel / Text) now honoured**

### Functional
- The interface's Output Type was saved but ignored: every run wrote CSV. It now
  controls the AP output file: `csv` (default), Excel (`.xlsx`) or Text (`.txt`,
  tab-separated). The header row follows `IncludeHeader` for all three.
- File extension follows the type; a `.csv`/`.xlsx`/`.xls`/`.txt` in
  `Email_Attachment_FileName` is replaced to match. Email attachment and SFTP
  upload use the generated file.
- Tracker: Output Type placeholder is now "CSV / Excel / Text".

### Technical
- `repository.py`: `output_type` -> `Output.Type` overlay key.
- `config.py`: `OutputConfig.type`, set by `_normalize_output_type()` (contains
  "xls"/"excel" -> xlsx, "txt"/"text" -> txt, else csv).
- `export_invoices_csv.py`: `build_ap_batch_filename(..., file_type)`;
  export uses `to_excel` / `to_csv(sep="	")` / `to_csv`.
- `requirements.txt`: `openpyxl`.

### Deploy
- `pip install -r requirements.txt` (adds `openpyxl`) on the Airflow environment.

### Known limits
- Output Type is free text in the tracker; unrecognised values fall back to CSV.

---

## v1.4.0 — `1298d0f` — 2026-10-11
**DB settings from environment, per-interface output, legacy export removed**

### Functional
- The database connection is no longer in `appsettings.yml`: it comes from
  `MYSQL_*` environment variables, read from the process environment or the
  its own project-root `.env` (or the file named by `PIPELINE_ENV_FILE`); the
  pipeline does not depend on the tracker. The tracker uses the same variable
  names in its own `.env`. `INTERFACE_SECRET_KEY` in the pipeline `.env` is also picked up, which fixes the "INTERFACE_SECRET_KEY is not
  set" decrypt error when the env file is present on the server.
- Output folder and file name are per interface. The folder is
  `interfaceconfiguration.Output_Directory`; a run (and the DAG preflight)
  fails at the start with a clear message when it is empty. CSV files are named
  `<InterfaceName>_<mmddyyyy>.csv`; `Email_Attachment_FileName` is an optional
  override (a legacy `{filename}` value now works instead of crashing).
- `fetch_ap_invoices.py` uses the shared config and pool instead of its own
  hardcoded credentials.
- Removed: the standalone full-history export (`python scripts/export_invoices_csv.py`).

### Technical
- `config.py`: `_load_mysql_config()` (python-dotenv, `override=False`; error
  names every missing variable); `MySqlConfig` gains `port`; `OutputConfig`
  is now just `folder` + `include_header`; `LoggingConfig.folder`,
  `ExportTableConfig`, `Output.FileName` and `Output.Tables` removed;
  attachment file name defaults to `""`.
- `db.py`: engine URL and cache key include the port.
- `export_invoices_csv.py`: `build_ap_batch_filename(template, date,
  interface_name)` with the new default; `resolve_output_path` requires the
  folder; `export_invoices_csv()`, `build_invoice_export()`,
  `build_export_filename()` deleted.
- `process_invoices.main()` and `invoice_execution_dag.preflight()` check
  `Output_Directory`.
- `appsettings.yml` reduced to `Logging.Level` and the `InvoiceApi` endpoints.
- Tracker backend: `DB_HOST/PORT/USER/PASSWORD/NAME/CONNECTION_LIMIT` renamed
  to `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE/CONNECTION_LIMIT` in `.env`,
  `.env.example`, `env.ts`, `pool.ts`, `schema.ts`, `align-db.ts`.
- New files: `.env.example` (pipeline env template), `scripts/make_secret_update_sql.py`
  (prints an `UPDATE` with `enc:v1:` values for `Platform_Password` /
  `Platform_AppAuthKey`), `sql/alter_run_log_and_response_columns.sql` (one
  re-runnable script adding every `run_log_id` / JSON-response column, index and
  FK), and the single-column scripts
  `sql/add_payment_batches_response_to_run_log.sql` and
  `sql/add_invoice_list_response_to_payment_file_details.sql` (superseded by the
  combined script).
- `requirements.txt`: `python-dotenv`. README, `docs/dag-deployment.md` and
  `dags/dag.deplyment.md` updated.

### Deploy
- Set `MYSQL_*` and `INTERFACE_SECRET_KEY` for the Airflow scheduler/worker (or
  `PIPELINE_ENV_FILE`) and restart them; `pip install -r requirements.txt`.
- Restart the tracker backend after renaming its `.env` variables (done in this
  clone's `.env`; do the same on any other machine).
- Make sure every interface row has `Output_Directory`.
- Run `sql/alter_run_log_and_response_columns.sql` on an existing DB.
- Create the pipeline `.env` next to `scripts/` (copy `.env.example`).

### Known limits
- Interface 1 on the local DB still has no `Platform_UserId` /
  `Platform_Password` / `Platform_AppAuthKey`; authentication fails until the
  `UPDATE` is run.
- `INTERFACE_SECRET_KEY` stays in the env file, not in the tracked yml.

---

## v1.3.0 — `1298d0f` — 2026-10-11
**Add version history and a pre-commit hook that enforces it**

### Functional
- Every commit now has a dated entry in this file, with its commit id, listing
  the functional and technical changes. A commit that doesn't update the file
  is blocked.

### Technical
- `docs/VERSION_HISTORY.md` created (entries for v1.1.0 and v1.2.0 backfilled).
- `.githooks/pre-commit`: fails unless this file is staged; replaces
  `` `pending` `` in headings that the previous commit (HEAD) introduced with
  that commit's short id, and re-stages the file.
- `.gitmessage`: commit message template with the checklist above.
- `.gitattributes`: `.githooks/* text eol=lf` so the hook keeps LF endings
  (CRLF would break the shell script on Windows checkouts).

### Deploy
- Per clone, once: `git config core.hooksPath .githooks` and
  `git config commit.template .gitmessage`.

### Known limits
- Hooks are local, not pushed: a fresh clone must run the config command, and
  `--no-verify` bypasses it.
- If the doc is only partly staged (`git add -p`), the hook stages the whole file.

---

## v1.2.0 — `d138eab` — 2026-10-11
**Scope runs to run_log_id, add no-batch email, pooled DB connections**

### Functional
- Raw API responses are now kept: the Get Payment Batches response is saved on
  the run (`ap_run_log.payment_batches_response`) and the Get Invoice List
  response on each batch (`ap_payment_file_details.invoice_list_response`).
  Each payload is stored as one JSON array of records, all pages combined.
- Database connections are pooled, so a run no longer opens a new connection
  for every CSV export.
- Interface credentials are read from the interface table: only the
  Authenticate endpoint stays in `appsettings.yml` (README §7.4).

### Technical
- `db.py` rewritten: one shared SQLAlchemy engine per process and database
  (`pool_size` from `MySql.PoolSize`, default 5; no overflow;
  `pool_pre_ping`; 30-minute `pool_recycle`). `get_connection()` returns a
  pooled DBAPI connection (`close()` returns it to the pool); `get_engine()`
  serves pandas; `set_autocommit()` sets autocommit on the real driver
  connection; `dispose_engines()` is called in `main()`'s `finally`.
- `db_log_handler.py` borrows its dedicated autocommit connection from the pool
  and resets autocommit to off before returning it.
- `export_invoices_csv.py` uses the shared engine; the per-batch
  `create_engine()` / `dispose()` is gone.
- `config.py` / `appsettings.yml`: new optional `MySql.PoolSize`.
- `repository.py`: `save_run_payment_batches_response()`,
  `save_payment_file_invoice_list_response()`.
- `sync_payment_files.py`: saves the Get Payment Batches records right after
  the call and commits them at once (new optional `conn` argument, passed by
  `main()`) so they survive a later rollback; saves each batch's Get Invoice
  List records in the batch's transaction (committed with the rest at step 2a).
- `create_tables.sql`: `ap_run_log.payment_batches_response JSON`,
  `ap_payment_file_details.invoice_list_response JSON`.

### Deploy
- Existing DB: run `sql/alter_run_log_and_response_columns.sql`, or recreate
  from `create_tables.sql`. Otherwise the saves fail with an unknown column.
- Interface credentials: fill `Platform_UserId`, `Platform_Password` and
  `Platform_AppAuthKey` on the interface row; set the same
  `INTERFACE_SECRET_KEY` as the tracker wherever the pipeline runs.

### Known limits
- The Get Invoice List payload is not saved if that call fails partway.
- `config.py` still reads the three auth credentials from the yml if someone
  adds them there (table value wins when set).

---

## v1.1.0 — `3260c66` — 2026-10-11
**Scope processing to current run; add no-batch email**

### Functional
- A run now processes only the payment batches it pulled itself (its
  `run_log_id`). `New` batches left behind by an earlier run that died are no
  longer picked up, so a run's emails, CSVs and SFTP uploads cover only that
  run (stale rows stay `New`; nothing cleans them up).
- When a run finds no batch to process — in any run mode (interface only,
  `--ap-batch-name`, a single date, a date range) — a standard "No AP batch
  found" email is sent. Same sender, recipients and `Email_Enabled` as the
  summary email; fixed subject/body, so a new interface needs no setup. It
  shows the interface, run log id, the search criteria (batch name, date, or
  from/to window) and how many batches the API returned.
- Invoice status updates can no longer overwrite another run's rows when the
  same invoice number is re-pulled.

### Technical
- `repository.get_open_payment_files(cursor, interface_id, run_log_id)` adds
  `AND run_log_id = ?` and returns `run_log_id`.
- New column `ap_invoices.run_log_id` (+ index, FK to `ap_run_log`); written by
  `insert_ap_invoice(..., run_log_id)` from the sync.
- `get_invoice_numbers_for_payment_file` replaced by
  `get_invoice_ids_by_number(cursor, payment_file_detail_id, run_log_id)` →
  `{invoice_number: [ap_invoice_id, ...]}`. `update_ap_invoice_status` now runs
  `WHERE ap_invoice_id IN (...) AND ap_paymentfile_id = ? AND run_log_id = ?`
  (previously `WHERE ap_invoice_number = ?`, which reached rows from other
  runs).
- `delivery.send_no_batch_email(...)`; `process_invoices.main()` calls it when
  step 3 returns no batch (a failed send is logged, not raised).
- `sync_payment_files.resolve_date_window()` extracted so `main()` can report
  the same window the sync used.
- `create_tables.sql`: `ap_run_log` moved above `ap_invoices` (FK order);
  `sql/add_run_log_id_to_ap_invoices.sql` added for existing DBs.
- Also committed: `dags/invoice_batch_adhoc_dag.py` and `dags/dag.deplyment.md`
  (previously untracked), README updates.

### Deploy
- Run `sql/add_run_log_id_to_ap_invoices.sql` (or recreate from
  `create_tables.sql`) before the next run.

### Known limits
- Rows overwritten by the old invoice-number update are not repaired.
- The date options (single date, date range) can only be run from the CLI;
  there is no ad-hoc DAG for them.
