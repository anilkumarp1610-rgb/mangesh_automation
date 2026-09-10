/**
 * Fail-fast assertion that the `airflow` database matches the shape the tracker
 * expects (sql/create_tables.sql + sql/migrate_payment_file_processing.sql, plus
 * tracker migrations 001/002).
 *
 * If a column is missing the message points at the fix (`npm run migrate` and/or
 * `npx tsx scripts/align-db.ts`) instead of letting queries fail cryptically later.
 */
import type { RowDataPacket } from 'mysql2';
import { env } from '../config/env.js';
import { pool } from './pool.js';
import { logger } from '../lib/logger.js';

const REQUIRED: { table: string; column: string; fix: string }[] = [
  {
    table: 'ap_payment_file_details',
    column: 'interface_id',
    fix: 'npx tsx scripts/align-db.ts',
  },
  {
    table: 'invoice_summary',
    column: 'ap_payment_file_detail_id',
    fix: 'npx tsx scripts/align-db.ts',
  },
  {
    table: 'ap_invoices_process_log',
    column: 'ap_payment_file_detail_id',
    fix: 'apply sql/create_tables.sql',
  },
];

export async function assertSchema(): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT table_name AS t, column_name AS c FROM information_schema.columns
      WHERE table_schema = ?`,
    [env.DB_NAME],
  );
  const present = new Set(rows.map((r) => `${String(r.t).toLowerCase()}.${String(r.c).toLowerCase()}`));

  const missing = REQUIRED.filter((r) => !present.has(`${r.table}.${r.column}`));
  if (missing.length > 0) {
    for (const m of missing) {
      logger.error(`schema: ${m.table}.${m.column} is missing — run: ${m.fix}`);
    }
    throw new Error(
      `Database schema is out of date (${missing.length} column(s) missing). See logs above.`,
    );
  }
  logger.info('schema check passed');
}
