/**
 * One-time remediation: bring the live `airflow` database into line with the
 * repo's SQL scripts (sql/create_tables.sql + sql/migrate_payment_file_processing.sql).
 *
 * Every change is guarded against information_schema, so this script is idempotent
 * and safe to re-run (and a no-op on a database that is already correct).
 *
 * Usage:  npx tsx scripts/align-db.ts          (report + apply)
 *         npx tsx scripts/align-db.ts --check   (report only, no changes)
 *
 * Intentional deviation from the scripts: ap_payment_file_details.id is left
 * AUTO_INCREMENT (tracker migration 001) so the tracker UI can insert batches.
 * (Migration 002 made the now-retired ap_invoices_process_log.id AUTO_INCREMENT
 * too -- moot since that table was merged into ap_payment_file_details, see
 * sql/migrate_merge_ap_invoices_process_log.sql.)
 */
import type { RowDataPacket } from 'mysql2';
import { closePool, pool } from '../src/db/pool.js';
import { env } from '../src/config/env.js';
import { logger } from '../src/lib/logger.js';

const CHECK_ONLY = process.argv.includes('--check');
const DB = env.DB_NAME;

async function q<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query<T[]>(sql, params);
  return rows;
}

async function columnType(table: string, column: string): Promise<string | null> {
  const rows = await q<RowDataPacket & { COLUMN_TYPE: string }>(
    `SELECT COLUMN_TYPE FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [DB, table, column],
  );
  return rows[0]?.COLUMN_TYPE ?? null;
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  return (await columnType(table, column)) !== null;
}

async function hasIndex(table: string, index: string): Promise<boolean> {
  const rows = await q<RowDataPacket & { c: number }>(
    `SELECT COUNT(*) AS c FROM information_schema.statistics
      WHERE table_schema = ? AND table_name = ? AND index_name = ?`,
    [DB, table, index],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

async function hasFk(name: string): Promise<boolean> {
  const rows = await q<RowDataPacket & { c: number }>(
    `SELECT COUNT(*) AS c FROM information_schema.table_constraints
      WHERE table_schema = ? AND constraint_name = ? AND constraint_type = 'FOREIGN KEY'`,
    [DB, name],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

interface Step {
  label: string;
  needed: () => Promise<boolean>;
  guard?: () => Promise<string | null>; // return a reason string to BLOCK, or null to proceed
  apply: string | (() => Promise<void>);
}

const steps: Step[] = [
  {
    label: 'ap_payment_file_details.interfaceid → interface_id',
    needed: async () =>
      (await hasColumn('ap_payment_file_details', 'interfaceid')) &&
      !(await hasColumn('ap_payment_file_details', 'interface_id')),
    apply: 'ALTER TABLE ap_payment_file_details CHANGE COLUMN interfaceid interface_id INT NULL',
  },
  {
    label: 'ap_payment_file_details KEY ix_payment_file_interface_status',
    needed: async () =>
      !(await hasIndex('ap_payment_file_details', 'ix_payment_file_interface_status')),
    apply:
      'ALTER TABLE ap_payment_file_details ADD KEY ix_payment_file_interface_status (interface_id, ap_batch_status)',
  },
  {
    label: 'ap_invoices.ap_invoice_id → BIGINT AUTO_INCREMENT',
    needed: async () => (await columnType('ap_invoices', 'ap_invoice_id')) !== 'bigint',
    apply: 'ALTER TABLE ap_invoices MODIFY ap_invoice_id BIGINT NOT NULL AUTO_INCREMENT',
  },
  {
    label: 'ap_invoices.ap_invoice_number → VARCHAR(100)',
    needed: async () => (await columnType('ap_invoices', 'ap_invoice_number')) !== 'varchar(100)',
    apply: 'ALTER TABLE ap_invoices MODIFY ap_invoice_number VARCHAR(100)',
  },
  {
    label: 'ap_invoices.created_date → NOT NULL DEFAULT CURRENT_TIMESTAMP',
    needed: async () => {
      const rows = await q<RowDataPacket & { IS_NULLABLE: string; d: string | null }>(
        `SELECT IS_NULLABLE, COLUMN_DEFAULT AS d FROM information_schema.columns
          WHERE table_schema = ? AND table_name = 'ap_invoices' AND column_name = 'created_date'`,
        [DB],
      );
      return rows[0]?.IS_NULLABLE !== 'NO' || rows[0]?.d == null;
    },
    guard: async () => {
      const rows = await q<RowDataPacket & { c: number }>(
        'SELECT COUNT(*) AS c FROM ap_invoices WHERE created_date IS NULL',
      );
      return Number(rows[0]?.c ?? 0) > 0
        ? `${rows[0]!.c} ap_invoices row(s) have NULL created_date — backfill first`
        : null;
    },
    apply:
      'ALTER TABLE ap_invoices MODIFY created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
  },
  {
    label: 'ap_invoices.api_response_obj → JSON',
    needed: async () => (await columnType('ap_invoices', 'api_response_obj')) !== 'json',
    guard: async () => {
      const rows = await q<RowDataPacket & { ap_invoice_id: number }>(
        'SELECT ap_invoice_id FROM ap_invoices WHERE api_response_obj IS NOT NULL AND JSON_VALID(api_response_obj) = 0',
      );
      return rows.length
        ? `ap_invoice_id(s) ${rows.map((r) => r.ap_invoice_id).join(', ')} hold non-JSON api_response_obj`
        : null;
    },
    apply: 'ALTER TABLE ap_invoices MODIFY api_response_obj JSON',
  },
  {
    label: 'ap_invoices.api_response_status_code → INT',
    needed: async () => (await columnType('ap_invoices', 'api_response_status_code')) !== 'int',
    guard: async () => {
      const rows = await q<RowDataPacket & { ap_invoice_id: number }>(
        `SELECT ap_invoice_id FROM ap_invoices
          WHERE api_response_status_code IS NOT NULL AND api_response_status_code NOT REGEXP '^[0-9]+$'`,
      );
      return rows.length
        ? `ap_invoice_id(s) ${rows.map((r) => r.ap_invoice_id).join(', ')} hold non-numeric api_response_status_code`
        : null;
    },
    apply: 'ALTER TABLE ap_invoices MODIFY api_response_status_code INT',
  },
  {
    label: 'ap_invoices KEY ix_ap_invoices_invoice_number',
    needed: async () => !(await hasIndex('ap_invoices', 'ix_ap_invoices_invoice_number')),
    apply: 'ALTER TABLE ap_invoices ADD KEY ix_ap_invoices_invoice_number (ap_invoice_number)',
  },
  {
    label: 'ap_invoices KEY ix_ap_invoices_paymentfile_id',
    needed: async () => !(await hasIndex('ap_invoices', 'ix_ap_invoices_paymentfile_id')),
    apply: 'ALTER TABLE ap_invoices ADD KEY ix_ap_invoices_paymentfile_id (ap_paymentfile_id)',
  },
  {
    label: 'invoice_summary.ap_payment_file_detail_id column',
    needed: async () => !(await hasColumn('invoice_summary', 'ap_payment_file_detail_id')),
    apply:
      'ALTER TABLE invoice_summary ADD COLUMN ap_payment_file_detail_id INT DEFAULT NULL AFTER invoice_process_uuid',
  },
  {
    label: 'FK fk_summary_payment_file (invoice_summary → ap_payment_file_details)',
    needed: async () => !(await hasFk('fk_summary_payment_file')),
    guard: async () => {
      if (!(await hasColumn('invoice_summary', 'ap_payment_file_detail_id'))) {
        return 'ap_payment_file_detail_id column not added yet (earlier step blocked?)';
      }
      const rows = await q<RowDataPacket & { c: number }>(
        `SELECT COUNT(*) AS c FROM invoice_summary s
          LEFT JOIN ap_payment_file_details b ON b.id = s.ap_payment_file_detail_id
          WHERE s.ap_payment_file_detail_id IS NOT NULL AND b.id IS NULL`,
      );
      return Number(rows[0]?.c ?? 0) > 0
        ? `${rows[0]!.c} invoice_summary row(s) reference a missing batch id`
        : null;
    },
    apply:
      'ALTER TABLE invoice_summary ADD CONSTRAINT fk_summary_payment_file FOREIGN KEY (ap_payment_file_detail_id) REFERENCES ap_payment_file_details (id)',
  },
];

async function run(): Promise<void> {
  let applied = 0;
  let skipped = 0;
  let blocked = 0;

  for (const step of steps) {
    if (!(await step.needed())) {
      logger.info(`✓ already aligned: ${step.label}`);
      skipped += 1;
      continue;
    }
    if (step.guard) {
      const reason = await step.guard();
      if (reason) {
        logger.error(`✗ BLOCKED: ${step.label} — ${reason}`);
        blocked += 1;
        continue;
      }
    }
    if (CHECK_ONLY) {
      logger.info(`• would apply: ${step.label}`);
      applied += 1;
      continue;
    }
    if (typeof step.apply === 'string') {
      await pool.query(step.apply);
    } else {
      await step.apply();
    }
    logger.info(`→ applied: ${step.label}`);
    applied += 1;
  }

  logger.info(
    `${CHECK_ONLY ? 'check' : 'align'} complete — ${applied} ${CHECK_ONLY ? 'pending' : 'applied'}, ${skipped} already aligned, ${blocked} blocked`,
  );
  if (blocked > 0) process.exitCode = 2;
}

run()
  .then(closePool)
  .catch(async (err) => {
    await closePool();
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
