# AP Tracker

Web app for the AP-invoice automation system:

1. **Manage interface configurations** (`interfaceconfiguration`)
2. **Create AP batches + invoice numbers** — the inputs the Python pipeline consumes
   (`ap_payment_file_details`, `ap_invoices`)
3. **Monitor** runs → batches → API calls → the 5 stored invoice tables
   (`ap_run_log`, `ap_process_log`, `invoice_response_log`, `invoice_summary`,
   `invoice_detail`, `invoice_line_detail`, `invoice_service`, `invoice_charge`)
4. **Trigger** a specific AP batch's reprocessing directly (spawns
   `process_invoices.py --ap-batch-name ...`), or the whole pipeline per
   interface via the Airflow REST API (still pending, see Phase status)

It talks to the **same MySQL `airflow` database** the Python pipeline uses. See
[`PLAN.md`](./PLAN.md) for the full design and phase breakdown.

```
tracker/
  backend/    Node 20+ · Express · TypeScript · mysql2
  frontend/   React 18 · Vite · TypeScript · Tailwind + shadcn/ui · TanStack Query/Table
```

## Prerequisites

- Node.js 20+
- The MySQL `airflow` database, reachable with the credentials in `config/appsettings.yml`

## Backend

```bash
cd backend
npm install
cp .env.example .env         # fill in MYSQL_* / INTERFACE_SECRET_KEY / AIRFLOW_*
npm run migrate              # applies tracker/backend/migrations/*.sql once
npm run align-db             # reconcile the live DB with the repo SQL scripts (idempotent)
npm run dev                  # http://localhost:4000  (GET /api/health)
```

| Script | Purpose |
|--------|---------|
| `npm run dev` | watch-mode dev server (tsx) |
| `npm run build` / `npm start` | compile to `dist/` and run |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run migrate` | apply pending SQL migrations, tracked in `tracker_migrations` |
| `npm run align-db` | reconcile the live `airflow` DB with the repo SQL scripts (idempotent; `-- --check` to dry-run) |
| `npm run seed:dev` | populate a sample dataset for local development |

## Frontend

```bash
cd frontend
npm install
cp .env.example .env         # VITE_API_TARGET defaults to http://localhost:4000
npm run dev                  # http://localhost:5173  (proxies /api to the backend)
```

## Phase status

| Phase | Scope | State |
|-------|-------|-------|
| **P1** | Scaffold: backend skeleton + DB pool + `/api/health`, migration runner, AES-GCM secret module, auth seam; frontend shell + nav + theme + reusable `DataGrid` + `JsonViewer` | ✅ done |
| **P2** | Read-only monitoring: Interfaces (+ detail sheet, secrets shown as set/not-set), AP Batches (+ drill: Invoices / Response Logs), AP Invoice detail, Invoice Explorer (+ Summary / Detail / line→service→charge tree), 5 raw data-table grids | ✅ done |
| **P3** | Interface **create / edit / activate** — sectioned form (`POST` / `PUT` / `PATCH :id/active`), AES-256-GCM secret encryption, matching Python `secret_crypto.decrypt_secret()` wired into `repository.py` | ✅ done |
| P4 | AP batch & invoice creation | pending |
| P5 | Pipeline trigger | **direct per-batch trigger done** (Reprocess button → `child_process.spawn`, see Run Logs section below); Airflow "Run now" (whole-interface, via its REST API + DAG `conf` tweak) still **pending** |
| P6 | Dashboard metrics, exports, polish | in progress — month-wise batch chart (New/Success/Failure) done; drill-down chain (Run → Batches → Invoices, and Interface → Batches → Invoice grids) done |

> [!NOTE]
> **Run Logs retired (2026-09-12)**: `ap_invoices_process_log` (one row per
> processing run) has been merged into `ap_payment_file_details` — a batch is
> only ever processed by one run at a time, so a single
> `invoice_process_uuid` column on the batch row now covers what a whole
> separate run-history table used to. The "Run Logs" nav item, its list/detail
> pages, and the "Runs" tab on the batch detail page are gone; the batch
> detail page's "Response Logs" tab now filters directly by the batch's own
> `invoice_process_uuid`. See
> [`sql/migrate_merge_ap_invoices_process_log.sql`](../sql/migrate_merge_ap_invoices_process_log.sql)
> in the pipeline repo root.

## Run Logs (new, 2026-09-21 — not a revival of the table above)

A **different** feature with a similar name: `ap_run_log` (one row per
`process_invoices.py` invocation — `interface_id` + the date window or
`--ap-batch-name` used, `started_at`) and `ap_process_log` (one row per log
line the run emitted, DB-backed logging added to the Python pipeline this
session — replaces its old log files). Neither table existed when "Run Logs"
above was retired; this is new, not un-retired.

- **`/run-logs`** — every run, with a computed AP Batch Count per run. Click
  the count to jump to `/ap-batches?f_runLogId=<id>` (AP Batches grid scoped
  to that run, reusing the same page/endpoint the Interfaces drill-down
  uses — now also filterable by **Client**, **AP Created date range**, and a
  **status switch** New/Success/Failed). Click **View** (or a row) to open
  that run's process log in a side sheet — filterable by level, polls every
  3s while open so an in-progress run's log fills in live without a
  WebSocket/SSE channel.
- **Reprocess** — on a batch's detail page (`Success`/`Failure` batches
  only), a button that looks up that batch's own `interface_id` +
  `ap_batch_name` (nothing to type) and calls
  `POST /api/ap-batches/:id/reprocess`. The backend spawns
  `process_invoices.py --interface-id <id> --ap-batch-name "<name>"` as a
  background child process — via `child_process.spawn()` with an argv array,
  never a shell string, so nothing client-controlled reaches a shell — polls
  for the `ap_run_log` row that run creates (matched by auto-increment id,
  not wall-clock time, so it's immune to clock skew between the tracker and
  DB hosts), and returns once found so the UI can jump straight to that run's
  live log sheet. The spawned process is **not** tied to the HTTP request's
  lifetime; if the row doesn't appear within
  `PIPELINE_TRIGGER_POLL_TIMEOUT_MS` the request fails but the process keeps
  running regardless.
- New backend env vars (`.env.example`): `PIPELINE_PYTHON_EXECUTABLE`,
  `PIPELINE_SCRIPTS_DIR` (point this at the Python pipeline's `scripts/`
  folder — defaults to `../../scripts`, i.e. this repo's own layout),
  `PIPELINE_TRIGGER_POLL_TIMEOUT_MS`.
- New endpoints: `GET /api/run-logs`, `GET /api/run-logs/:id`,
  `GET /api/run-logs/:id/process-logs`, `POST /api/ap-batches/:id/reprocess`.
- `assertSchema()` now also checks for `ap_run_log`, `ap_process_log`, and
  `ap_payment_file_details.run_log_id` — fix hint points at
  `sql/apply_logging_changes.sql` in the pipeline repo root. **Not yet**
  folded into `align-db.ts` (see Schema alignment section) — apply that SQL
  file by hand for now if `assertSchema()` reports it missing.

## Dev seed

`npx tsx scripts/seed-dev.ts` (from `backend/`) creates a complete sample dataset —
4 AP batches, response logs, and a full invoice tree — so every screen has
data. It only fills tables that are empty and re-points the existing
`ap_invoices` seed rows at the batches it creates.

## Schema alignment

The running `airflow` database originally diverged from the repo's SQL scripts.
`npx tsx scripts/align-db.ts` (from `backend/`) reconciles it — idempotent, guarded
against `information_schema`, and a no-op on an already-correct database. It applied:

| Change | Source |
|---|---|
| `ap_payment_file_details.interfaceid` → `interface_id` (+ `ix_payment_file_interface_status`) | create_tables.sql |
| `ap_invoices.ap_invoice_id` → `BIGINT AUTO_INCREMENT`, `ap_invoice_number` → `VARCHAR(100)`, `created_date` NOT NULL DEFAULT, `+ ix_ap_invoices_*` | create_tables.sql |
| `ap_invoices.api_response_obj` → `JSON`, `api_response_status_code` → `INT` | create_tables.sql |
| `invoice_summary.ap_payment_file_detail_id` column + `fk_summary_payment_file` | migrate_payment_file_processing.sql |
| ~~`fk_process_log_payment_file` on `ap_invoices_process_log`~~ | migrate_payment_file_processing.sql — table retired, step removed from `align-db.ts` (see note above) |
| `ap_payment_file_details.id` → `AUTO_INCREMENT` (`ap_invoices_process_log.id` too, historically — moot now) | tracker migrations 001 / 002 |

The backend runs `assertSchema()` at startup (`src/db/schema.ts`) and refuses to
start with a clear message if a required column is still missing.

The one deliberate deviation from the scripts: `ap_payment_file_details.id` is
`AUTO_INCREMENT` (the tracker inserts batches) — `sql/create_tables.sql` has been
updated to match.

**Side effect:** `scripts/repository.py` (Python) queries `interface_id`, which now
exists — the pipeline's `get_open_payment_files` works against this DB again.

## Notes

- **Writes** are limited to `interfaceconfiguration`, `ap_payment_file_details`,
  `ap_invoices`. Every other table is read-only. The Reprocess feature (see
  Run Logs section) is a separate capability class — it never writes to the
  DB itself, it spawns the Python pipeline as a child process, which then
  writes via its own normal DB path.
- **Auth**: none in v1. `backend/src/middleware/auth.ts` is the single seam where SSO
  plugs in later.
- **Secret encryption**: the tracker writes the 5 secret columns in
  `interfaceconfiguration` as `enc:v1:<base64>` (AES-256-GCM), keyed by
  `INTERFACE_SECRET_KEY` (`backend/.env`; generate with `openssl rand -base64 32`).
  **The Python pipeline needs the same key** in its `INTERFACE_SECRET_KEY` env var —
  `scripts/secret_crypto.py` + `scripts/repository.py` decrypt on read and pass legacy
  plaintext through untouched. Migration `003` widened `Platform_DB_Password` to
  `VARCHAR(500)` to fit the ciphertext.
