# Tracker — Frontend + Backend Plan

A standalone web app (separate from the Python/Airflow pipeline) to **add records**
and **monitor** the AP-invoice processing system.

---

## 1. Goals

| # | Capability | Tables involved |
|---|------------|-----------------|
| 1 | Manage **Interface configurations** (create / edit / activate) | `interfaceconfiguration` |
| 2 | Create **AP batches** + attach **invoice numbers** (pipeline inputs) | `ap_payment_file_details`, `ap_invoices` |
| 3 | Monitor **batches → API calls → stored invoice data** | `invoice_response_log`, `ap_invoices`, `invoice_summary`, `invoice_detail`, `invoice_line_detail`, `invoice_service`, `invoice_charge` |
| 4 | **Trigger** the pipeline for an interface (Airflow REST API) | — |

> [!NOTE]
> **Updated 2026-09-12**: `ap_invoices_process_log` was merged into
> `ap_payment_file_details` (a single `invoice_process_uuid` column on the
> batch row, since a batch is only ever processed by one run at a time) — the
> "runs" concept and the P2 "Run Logs" feature described below were retired
> alongside it. The row/diagram above reflect the current shape; see
> `tracker/README.md` for details.

### Data model (as it exists today)

```
interfaceconfiguration ─< ap_payment_file_details ─< ap_invoices        (inputs + last API status/response;
                                   │                                     invoice_process_uuid on the batch row)
                         invoice_response_log                           (1 row per API call: url, http code, JSON body, error)
                                   │
                         invoice_summary ─ invoice_detail ─< invoice_line_detail ─< invoice_service ─< invoice_charge
```

`invoice_summary.log_id` / `invoice_process_uuid` / `ap_payment_file_detail_id` link stored
data back to the run and batch. `invoice_detail.invoice_id` → `invoice_summary.invoice_id`.

---

## 2. Decisions (confirmed)

| Topic | Decision | Impact |
|-------|----------|--------|
| **Auth** | SSO — **later phase**. Build a pluggable auth middleware seam now; no login page in v1. | Low now |
| **Interface secrets** | **Encrypted at rest** (AES‑256‑GCM, key in `.env`). | ⚠ Python side must decrypt too — see §6 |
| **Pipeline trigger** | **Airflow REST API** "Run now" button per interface. | ⚠ DAG tweak + Airflow creds — see §6 |
| **`ap_payment_file_details.id`** | **Add `AUTO_INCREMENT` migration**. | New migration file |

---

## 3. Architecture

```
tracker/
  backend/                 Node 20 + Express + TypeScript
    src/
      config/              env loading (zod-validated), db pool
      db/                  mysql2/promise pool, query helpers
      crypto/              AES-256-GCM encrypt/decrypt for interface secrets
      lib/                 pagination, sort/filter allowlists, errors
      modules/
        interfaces/        routes · controller · service · repo
        apBatches/
        apInvoices/
        processLogs/
        responseLogs/
        invoices/          summary/detail/line/service/charge grids + nested tree
        airflow/           trigger client
      app.ts / server.ts
    migrations/            *.sql (run manually or via a tiny runner)
    .env.example

  frontend/                React 18 + Vite + TypeScript
    src/
      components/ui/        shadcn/ui primitives
      components/DataGrid/  reusable server-side table
      components/JsonViewer, SectionForm, PageHeader, ...
      lib/                  api client (fetch + zod), query client
      routes/               React Router route tree
      pages/                Dashboard, Interfaces, ApBatches, InvoiceExplorer, RunLogs
    .env.example
```

- Backend ↔ same `airflow` MySQL DB. Creds from `.env` (mirrors `config/appsettings.yml`).
- **Writes limited to** `interfaceconfiguration`, `ap_payment_file_details`, `ap_invoices`.
  Everything else strictly read-only.

### Stack choices

**Backend:** Express, `mysql2/promise`, `zod` (request + env validation), `pino` logging,
`helmet` + `cors`. Layered `routes → controller → service → repository`.

**Frontend:** Vite + React + TS, TailwindCSS + **shadcn/ui**, **TanStack Query** (server
state / caching), **TanStack Table v8** (grids), React Router v6, React Hook Form + zod
resolver, `sonner` toasts.

---

## 4. Backend API

All list endpoints accept: `?page`, `pageSize`, `sort`, `order=asc|desc`, and
`filter.<column>=<value>` (contains / eq / range). **Sort & filter columns are validated
against a per-table allowlist** — no raw identifiers reach SQL. JSON columns are parsed
before returning.

| Group | Endpoints |
|-------|-----------|
| **interfaces** | `GET /api/interfaces` · `GET /api/interfaces/:id` (secrets decrypted, still masked client-side) · `POST` · `PUT /:id` · `PATCH /:id/active` |
| **ap-batches** | `GET /api/ap-batches` (join interface name, invoice count, run count, status) · `GET /:id` (batch + invoices + runs + status rollup) · `POST` (create batch + optional invoice-number list) · `POST /:id/invoices` (attach more) |
| **ap-invoices** | `GET /api/ap-invoices` · `GET /:id` (row + `api_response_obj` + linked `invoice_response_log` rows + linked `invoice_summary`) |
| **process-logs** | `GET /api/process-logs` (join batch) · `GET /:uuid` (all response-log rows + summaries for that run) |
| **response-logs** | `GET /api/response-logs` · `GET /:id` (full url, `response_body`, `error_message`) |
| **invoices** | `GET /api/invoices/:invoiceId/summary` · `/detail` · `/tree` (line→service→charge nested) · plus flat grids `GET /api/invoice-summary` `/invoice-detail` `/invoice-line-detail` `/invoice-service` `/invoice-charge` |
| **airflow** | `POST /api/airflow/trigger` `{ interfaceId }` → triggers DAG run, returns dag_run_id · `GET /api/airflow/runs?interfaceId=` (recent runs/status) |
| **meta** | `GET /health` · `GET /api/interfaces/options` (id+name for dropdowns) |

Cross-cutting: pagination helper, error middleware (zod → 400, not-found → 404), request
logging, graceful pool shutdown.

---

## 5. Frontend

### Reusable `<DataGrid>` (every "grid data" requirement)
Server-side **pagination**, **multi-column sort**, **per-column filter**, column show/hide,
density toggle, sticky header, loading skeletons, empty/error states, row click → detail
drawer or route, **CSV export of current view**. URL-synced state (shareable links).

### Layout
shadcn sidebar nav + top bar + breadcrumbs + toaster. Route tree:

1. **Dashboard** — tiles: active interfaces, open (`New`) batches, runs today, failed
   invoices; recent runs table; recent failed API calls.

2. **Interfaces**
   - Grid: name, active, host summaries, created/modified.
   - **New / Edit** = sectioned form (shadcn Tabs): **General · SFTP · SMTP · Platform API ·
     Platform DB · Email · Failure Notification · Output**.
   - Password/key fields: masked input + reveal toggle; on edit, blank = "leave unchanged".
   - Recipient `LONGTEXT` fields: tag/list editor (comma/newline paste supported).
   - Active toggle; "Run now" button (→ Airflow trigger) with run-status pill.

3. **AP Batches**
   - Grid: batch name, interface, status, processed date, # invoices, # runs.
   - **New Batch** form: interface (dropdown), batch name, `ap_batch_payment_file_id`,
     status (default `New`), invoice numbers (repeater + bulk paste).
   - Row → **Batch Detail**: header (status, dates, linked run) + tabs:
     - **Invoices** — `ap_invoices` grid for the batch → row → Invoice Detail
     - **Runs** — `ap_invoices_process_log` grid → row → run's response logs + summaries
     - **Response Logs** — `invoice_response_log` scoped to this batch's run UUIDs

4. **Invoice Explorer** — search by invoice number / id → **Invoice Detail** tabs:
   - **API Status** — `ap_invoices`: status, status code, `api_response_obj` JSON viewer
   - **Response Log** — matching `invoice_response_log` rows, JSON body viewer, url, errors
   - **Summary** — `invoice_summary` row (grouped fields)
   - **Detail** — `invoice_detail` row (wide → grouped display)
   - **Lines / Services / Charges** — `invoice_line_detail` → expand `invoice_service` →
     expand `invoice_charge`; each also available as a flat filterable grid

5. **Run Logs** — global `ap_invoices_process_log` grid + `invoice_response_log` grid;
   filters: success/failure, date range, invoice number, interface.

Shared components: `<JsonViewer>` (collapsible, copy), `<SectionForm>`, `<StatusBadge>`,
`<CopyButton>`, `<DateCell>`.

---

## 6. Schema / coordination changes

1. **New migration** `tracker/backend/migrations/001_ap_payment_file_details_autoincrement.sql`
   ```sql
   ALTER TABLE ap_payment_file_details MODIFY id INT NOT NULL AUTO_INCREMENT;
   ```

2. **Secret encryption — Python side must stay in sync.** The tracker will store the 5
   secret columns (`SFTP_Password`, `SMTP_Password`, `Platform_Password`,
   `Platform_AppAuthKey`, `Platform_DB_Password`) as `enc:v1:<base64(iv|tag|ciphertext)>`.
   `scripts/repository.py::load_interface_configuration` reads those columns directly, so it
   needs a matching **`decrypt_secret()` helper** (AES‑256‑GCM, same key via env var
   `INTERFACE_SECRET_KEY`) applied to those columns, with a pass-through when the value
   isn't `enc:v1:`‑prefixed (so existing plaintext rows keep working during rollout).
   → Small, contained change to one Python function + one new helper module. **Included in
   this plan's scope** unless you'd rather keep encryption tracker-only for now.

3. **Airflow trigger — DAG tweak.** `dags/invoice_execution_dag.py` currently reads the
   interface id from the Airflow Variable `invoice_execution_interface_id`. To trigger a
   specific interface from the UI, `_resolve_interface_id()` should prefer
   `context["dag_run"].conf.get("interface_id")` and fall back to the Variable. The backend
   then calls `POST /api/v1/dags/invoice_execution_dag/dagRuns` with
   `{ "conf": { "interface_id": <id> } }`. Needs `AIRFLOW_BASE_URL`, `AIRFLOW_USERNAME`,
   `AIRFLOW_PASSWORD` (or token) in backend `.env`.

---

## 7. Delivery phases

| Phase | Deliverable |
|-------|-------------|
| **P1 — Scaffold** | Backend Express+TS skeleton, zod-validated env, mysql2 pool, `/health`. Frontend Vite+Tailwind+shadcn init, layout/nav, `<DataGrid>` + `<JsonViewer>`, API client. |
| **P2 — Read-only monitoring** | Interfaces list, AP Batches list + detail (Invoices/Runs/Response Logs tabs), Invoice Explorer + all tabs, Run Logs, 5 flat invoice-table grids. *Highest value, zero write risk.* |
| **P3 — Interface CRUD** | Sectioned create/edit form + AES‑GCM crypto module + Python `decrypt_secret()` change + migration for encrypted rollout. |
| **P4 — Batch & invoice creation** | `ap_payment_file_details.id` AUTO_INCREMENT migration, New Batch form, attach-invoices flow. |
| **P5 — Airflow trigger** | DAG `conf` tweak, trigger endpoint + client, "Run now" button + run-status polling. |
| **P6 — Polish** | Dashboard, CSV export, column presets, empty/error states, `tracker/README.md`, `.env.example` files. |

---

## 8. Out of scope (v1)

- SSO / login UI (seam only).
- Editing stored invoice data (summary/detail/line/service/charge are read-only).
- Encryption key rotation tooling.
- Deleting batches / invoices.
