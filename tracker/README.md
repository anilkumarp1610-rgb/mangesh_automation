# AP Tracker

Web app for the AP-invoice automation system:

1. **Manage interface configurations** (`interfaceconfiguration`)
2. **Create AP batches + invoice numbers** — the inputs the Python pipeline consumes
   (`ap_payment_file_details`, `ap_invoices`)
3. **Monitor** batches → runs → API calls → the 5 stored invoice tables
   (`ap_invoices_process_log`, `invoice_response_log`, `invoice_summary`, `invoice_detail`,
   `invoice_line_detail`, `invoice_service`, `invoice_charge`)
4. **Trigger** the pipeline per interface via the Airflow REST API

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
cp .env.example .env         # fill in DB_* / INTERFACE_SECRET_KEY / AIRFLOW_*
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
| **P2** | Read-only monitoring: Interfaces (+ detail sheet, secrets shown as set/not-set), AP Batches (+ drill: Invoices / Runs / Response Logs), AP Invoice detail, Invoice Explorer (+ Summary / Detail / line→service→charge tree), Run Logs (runs + API calls), 5 raw data-table grids | ✅ done |
| **P3** | Interface **create / edit / activate** — sectioned form (`POST` / `PUT` / `PATCH :id/active`), AES-256-GCM secret encryption, matching Python `secret_crypto.decrypt_secret()` wired into `repository.py` | ✅ done |
| P4 | AP batch & invoice creation | pending |
| P5 | Airflow "Run now" trigger (+ DAG `conf` tweak) | pending |
| P6 | Dashboard metrics, exports, polish | in progress — month-wise batch chart done; drill-down chain (Interface → Batches → Runs → Invoice grids) done |

## Dev seed

`npx tsx scripts/seed-dev.ts` (from `backend/`) creates a complete sample dataset —
4 AP batches, a process-log run, response logs, and a full invoice tree — so every
screen has data. It only fills tables that are empty and re-points the existing
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
| `fk_process_log_payment_file` on `ap_invoices_process_log` | migrate_payment_file_processing.sql |
| `ap_payment_file_details.id` / `ap_invoices_process_log.id` → `AUTO_INCREMENT` | tracker migrations 001 / 002 |

The backend runs `assertSchema()` at startup (`src/db/schema.ts`) and refuses to
start with a clear message if a required column is still missing.

The one deliberate deviation from the scripts: `ap_payment_file_details.id` is
`AUTO_INCREMENT` (the tracker inserts batches) — `sql/create_tables.sql` has been
updated to match.

**Side effect:** `scripts/repository.py` (Python) queries `interface_id`, which now
exists — the pipeline's `get_open_payment_files` works against this DB again.

## Notes

- **Writes** are limited to `interfaceconfiguration`, `ap_payment_file_details`,
  `ap_invoices`. Every other table is read-only.
- **Auth**: none in v1. `backend/src/middleware/auth.ts` is the single seam where SSO
  plugs in later.
- **Secret encryption**: the tracker writes the 5 secret columns in
  `interfaceconfiguration` as `enc:v1:<base64>` (AES-256-GCM), keyed by
  `INTERFACE_SECRET_KEY` (`backend/.env`; generate with `openssl rand -base64 32`).
  **The Python pipeline needs the same key** in its `INTERFACE_SECRET_KEY` env var —
  `scripts/secret_crypto.py` + `scripts/repository.py` decrypt on read and pass legacy
  plaintext through untouched. Migration `003` widened `Platform_DB_Password` to
  `VARCHAR(500)` to fit the ciphertext.
