import type { Request } from 'express';
import type { RowDataPacket } from 'mysql2';
import { query, queryOne } from '../../db/pool.js';
import { runList } from '../../lib/list.js';
import type { ListConfig } from '../../lib/listQuery.js';

// ap_run_log: one row per process_invoices.py invocation (see
// sql/create_run_log_table.sql in the Python pipeline). ap_payment_file_details
// rows pulled by that run carry run_log_id (nullable -- rows inserted before
// this column existed have no run to point to).
const listConfig: ListConfig = {
  defaultSort: { field: 'id', order: 'desc' },
  fields: {
    id: { column: 'r.id', type: 'number' },
    interfaceId: { column: 'r.interface_id', type: 'number' },
    interfaceName: { column: 'i.InterfaceName', type: 'string' },
    fromDate: { column: 'r.from_date', type: 'date' },
    toDate: { column: 'r.to_date', type: 'date' },
    apBatchName: { column: 'r.ap_batch_name', type: 'string' },
    startedAt: { column: 'r.started_at', type: 'date' },
  },
};

const FROM = `
  FROM ap_run_log r
  LEFT JOIN interfaceconfiguration i ON i.InterfaceId = r.interface_id`;

const BATCH_COUNT_SUBQUERY = `
  (SELECT COUNT(*) FROM ap_payment_file_details p WHERE p.run_log_id = r.id) AS batch_count`;

export function listRunLogs(req: Request) {
  return runList<RowDataPacket>(req, listConfig, {
    selectSql: `
      SELECT r.id, r.interface_id, i.InterfaceName AS interface_name,
             r.from_date, r.to_date, r.ap_batch_name, r.started_at,
             ${BATCH_COUNT_SUBQUERY}`,
    fromSql: FROM,
  });
}

export async function getRunLog(id: number) {
  const runLog = await queryOne<RowDataPacket>(
    `SELECT r.*, i.InterfaceName AS interface_name, ${BATCH_COUNT_SUBQUERY}
       FROM ap_run_log r
       LEFT JOIN interfaceconfiguration i ON i.InterfaceId = r.interface_id
      WHERE r.id = ?`,
    [id],
  );
  if (!runLog) return null;

  const statusRollup = await query<RowDataPacket>(
    `SELECT ap_batch_status AS status, COUNT(*) AS count
       FROM ap_payment_file_details WHERE run_log_id = ?
      GROUP BY ap_batch_status`,
    [id],
  );

  return { ...runLog, statusRollup };
}

const PROCESS_LOG_CONFIG: ListConfig = {
  defaultSort: { field: 'id', order: 'asc' },
  fields: {
    id: { column: 'pl.id', type: 'number' },
    logLevel: {
      column: 'pl.log_level',
      type: 'enum',
      values: ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'],
    },
    loggerName: { column: 'pl.logger_name', type: 'string' },
    message: { column: 'pl.message', type: 'string' },
    apPaymentFileDetailId: { column: 'pl.ap_payment_file_detail_id', type: 'number' },
    createdDatetime: { column: 'pl.created_datetime', type: 'date' },
  },
};

/** ap_process_log rows for one run -- no FK on ap_payment_file_detail_id by
 * design (see sql/create_process_log_table.sql), so this just scopes by
 * run_log_id, which IS FK'd and always set. */
export function listProcessLogs(req: Request, runLogId: number) {
  return runList<RowDataPacket>(req, PROCESS_LOG_CONFIG, {
    selectSql: `SELECT pl.id, pl.run_log_id, pl.ap_payment_file_detail_id,
                       pl.log_level, pl.logger_name, pl.message, pl.created_datetime`,
    fromSql: 'FROM ap_process_log pl',
    scope: { sql: 'pl.run_log_id = ?', params: [runLogId] },
  });
}
