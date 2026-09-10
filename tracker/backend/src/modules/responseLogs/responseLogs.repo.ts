import type { Request } from 'express';
import type { RowDataPacket } from 'mysql2';
import { queryOne } from '../../db/pool.js';
import { runList } from '../../lib/list.js';
import type { ListConfig } from '../../lib/listQuery.js';
import { parseJsonColumn } from '../../lib/json.js';

export const listConfig: ListConfig = {
  defaultSort: { field: 'logId', order: 'desc' },
  fields: {
    logId: { column: 'rl.log_id', type: 'number' },
    invoiceNumber: { column: 'rl.invoice_number', type: 'string' },
    httpStatusCode: { column: 'rl.http_status_code', type: 'number' },
    isSuccess: { column: 'rl.is_success', type: 'bool' },
    responseMessage: { column: 'rl.response_message', type: 'string' },
    invoiceProcessUuid: { column: 'rl.invoice_process_uuid', type: 'string' },
    createdDatetime: { column: 'rl.created_datetime', type: 'date' },
  },
};

export function listResponseLogs(req: Request) {
  return runList<RowDataPacket>(req, listConfig, {
    selectSql: `SELECT rl.log_id, rl.invoice_number, rl.request_url, rl.http_status_code,
                       rl.is_success, rl.response_message, rl.error_message,
                       rl.invoice_process_uuid, rl.created_datetime`,
    fromSql: 'FROM invoice_response_log rl',
  });
}

export async function getResponseLog(id: number) {
  const row = await queryOne<RowDataPacket>('SELECT * FROM invoice_response_log WHERE log_id = ?', [
    id,
  ]);
  if (!row) return null;
  return { ...row, response_body: parseJsonColumn(row.response_body) };
}
