import type { Request } from 'express';
import type { RowDataPacket } from 'mysql2';
import { query, queryOne } from '../../db/pool.js';
import { runList } from '../../lib/list.js';
import type { ListConfig } from '../../lib/listQuery.js';

const listConfig: ListConfig = {
  defaultSort: { field: 'id', order: 'desc' },
  fields: {
    id: { column: 'b.id', type: 'number' },
    batchName: { column: 'b.ap_batch_name', type: 'string' },
    paymentFileId: { column: 'b.ap_batch_payment_file_id', type: 'number' },
    interfaceId: { column: 'b.interface_id', type: 'number' },
    interfaceName: { column: 'i.InterfaceName', type: 'string' },
    status: {
      column: 'b.ap_batch_status',
      type: 'enum',
      values: ['New', 'Success', 'Failure'],
    },
    processedDate: { column: 'b.processed_date', type: 'date' },
    logId: { column: 'b.log_id', type: 'number' },
  },
};

const FROM = `
  FROM ap_payment_file_details b
  LEFT JOIN interfaceconfiguration i ON i.InterfaceId = b.interface_id`;

export function listBatches(req: Request) {
  return runList<RowDataPacket>(req, listConfig, {
    selectSql: `
      SELECT b.id, b.ap_batch_name, b.ap_batch_payment_file_id, b.interface_id,
             i.InterfaceName AS interface_name,
             b.ap_batch_status, b.processed_date, b.log_id,
             (SELECT COUNT(*) FROM ap_invoices ai WHERE ai.ap_paymentfile_id = b.id) AS invoice_count,
             (SELECT COUNT(*) FROM ap_invoices ai
                WHERE ai.ap_paymentfile_id = b.id AND ai.ap_invoice_api_status = 'FAILED') AS invoice_failed_count,
             (SELECT COUNT(*) FROM ap_invoices_process_log pl WHERE pl.ap_payment_file_detail_id = b.id) AS run_count`,
    fromSql: FROM,
  });
}

export async function getBatch(id: number) {
  const batch = await queryOne<RowDataPacket>(
    `SELECT b.*, i.InterfaceName AS interface_name
       FROM ap_payment_file_details b
       LEFT JOIN interfaceconfiguration i ON i.InterfaceId = b.interface_id
      WHERE b.id = ?`,
    [id],
  );
  if (!batch) return null;

  const [statusRollup, runs] = await Promise.all([
    query<RowDataPacket>(
      `SELECT ap_invoice_api_status AS status, COUNT(*) AS count
         FROM ap_invoices WHERE ap_paymentfile_id = ?
        GROUP BY ap_invoice_api_status`,
      [id],
    ),
    query<RowDataPacket>(
      `SELECT pl.id, pl.proces_datetime, pl.invoice_process_uuid,
              (SELECT COUNT(*) FROM invoice_response_log rl
                 WHERE rl.invoice_process_uuid = pl.invoice_process_uuid) AS response_log_count,
              (SELECT COUNT(*) FROM invoice_summary s
                 WHERE s.invoice_process_uuid = pl.invoice_process_uuid) AS summary_count
         FROM ap_invoices_process_log pl
        WHERE pl.ap_payment_file_detail_id = ?
        ORDER BY pl.id DESC`,
      [id],
    ),
  ]);

  return { ...batch, statusRollup, runs };
}

const INVOICE_LIST_CONFIG: ListConfig = {
  defaultSort: { field: 'apInvoiceId', order: 'asc' },
  fields: {
    apInvoiceId: { column: 'ai.ap_invoice_id', type: 'number' },
    apInvoiceNumber: { column: 'ai.ap_invoice_number', type: 'string' },
    apInvoiceApiStatus: {
      column: 'ai.ap_invoice_api_status',
      type: 'enum',
      values: ['SUCCESS', 'PENDING', 'FAILED'],
    },
    apiResponseStatusCode: { column: 'ai.api_response_status_code', type: 'number' },
    createdDate: { column: 'ai.created_date', type: 'date' },
  },
};

export function listBatchInvoices(req: Request, batchId: number) {
  return runList<RowDataPacket>(req, INVOICE_LIST_CONFIG, {
    selectSql: `SELECT ai.ap_invoice_id, ai.ap_invoice_number, ai.ap_paymentfile_id,
                       ai.created_date, ai.ap_invoice_api_status, ai.api_response_status_code`,
    fromSql: 'FROM ap_invoices ai',
    scope: { sql: 'ai.ap_paymentfile_id = ?', params: [batchId] },
  });
}
