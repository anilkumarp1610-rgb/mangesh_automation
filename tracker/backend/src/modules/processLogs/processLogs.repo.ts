import type { Request } from 'express';
import type { RowDataPacket } from 'mysql2';
import { query, queryOne } from '../../db/pool.js';
import { runList } from '../../lib/list.js';
import type { ListConfig } from '../../lib/listQuery.js';

const listConfig: ListConfig = {
  defaultSort: { field: 'id', order: 'desc' },
  fields: {
    id: { column: 'pl.id', type: 'number' },
    procesDatetime: { column: 'pl.proces_datetime', type: 'date' },
    invoiceProcessUuid: { column: 'pl.invoice_process_uuid', type: 'string' },
    batchId: { column: 'pl.ap_payment_file_detail_id', type: 'number' },
    batchName: { column: 'b.ap_batch_name', type: 'string' },
    interfaceId: { column: 'b.interface_id', type: 'number' },
    status: { column: 'b.ap_batch_status', type: 'string' },
  },
};

const FROM = `
  FROM ap_invoices_process_log pl
  LEFT JOIN ap_payment_file_details b ON b.id = pl.ap_payment_file_detail_id`;

export function listProcessLogs(req: Request) {
  return runList<RowDataPacket>(req, listConfig, {
    selectSql: `SELECT pl.id, pl.proces_datetime, pl.invoice_process_uuid,
                       pl.ap_payment_file_detail_id, b.ap_batch_name,
                       b.interface_id, b.ap_batch_status,
                       (SELECT COUNT(*) FROM invoice_response_log rl
                          WHERE rl.invoice_process_uuid = pl.invoice_process_uuid) AS response_log_count,
                       (SELECT COUNT(*) FROM invoice_response_log rl
                          WHERE rl.invoice_process_uuid = pl.invoice_process_uuid AND rl.is_success = 0) AS response_log_failed_count,
                       (SELECT COUNT(DISTINCT rl.invoice_number) FROM invoice_response_log rl
                          WHERE rl.invoice_process_uuid = pl.invoice_process_uuid) AS invoice_count,
                       (SELECT COUNT(*) FROM invoice_summary s
                          WHERE s.invoice_process_uuid = pl.invoice_process_uuid) AS summary_count`,
    fromSql: FROM,
  });
}

export async function getProcessLog(id: number) {
  const log = await queryOne<RowDataPacket>(
    `SELECT pl.*, b.ap_batch_name, b.interface_id, b.ap_batch_status,
            i.InterfaceName AS interface_name
       FROM ap_invoices_process_log pl
       LEFT JOIN ap_payment_file_details b ON b.id = pl.ap_payment_file_detail_id
       LEFT JOIN interfaceconfiguration i ON i.InterfaceId = b.interface_id
      WHERE pl.id = ?`,
    [id],
  );
  if (!log) return null;
  const uuid = log.invoice_process_uuid as string | null;

  const [responseLogs, summaries] = await Promise.all([
    uuid
      ? query<RowDataPacket>(
          `SELECT rl.log_id, rl.invoice_number, rl.request_url, rl.http_status_code, rl.is_success,
                  rl.response_message, rl.error_message, rl.created_datetime,
                  s.invoice_id
             FROM invoice_response_log rl
             LEFT JOIN invoice_summary s
               ON s.invoice_number = rl.invoice_number AND s.invoice_process_uuid = rl.invoice_process_uuid
            WHERE rl.invoice_process_uuid = ?
            ORDER BY rl.created_datetime`,
          [uuid],
        )
      : Promise.resolve([]),
    uuid
      ? query<RowDataPacket>(
          `SELECT summary_id, invoice_id, invoice_number, total_amount_due, amount_to_pay,
                  currency_symbol, account_number, fetched_datetime
             FROM invoice_summary WHERE invoice_process_uuid = ?
            ORDER BY invoice_number`,
          [uuid],
        )
      : Promise.resolve([]),
  ]);

  return { ...log, responseLogs, summaries };
}
