import type { Request } from 'express';
import type { RowDataPacket } from 'mysql2';
import { query, queryOne } from '../../db/pool.js';
import { runList } from '../../lib/list.js';
import type { ListConfig } from '../../lib/listQuery.js';
import { parseJsonColumn } from '../../lib/json.js';

const listConfig: ListConfig = {
  defaultSort: { field: 'apInvoiceId', order: 'desc' },
  fields: {
    apInvoiceId: { column: 'ai.ap_invoice_id', type: 'number' },
    apInvoiceNumber: { column: 'ai.ap_invoice_number', type: 'string' },
    apPaymentFileId: { column: 'ai.ap_paymentfile_id', type: 'number' },
    batchName: { column: 'b.ap_batch_name', type: 'string' },
    interfaceId: { column: 'b.interface_id', type: 'number' },
    apiStatus: {
      column: 'ai.ap_invoice_api_status',
      type: 'enum',
      values: ['SUCCESS', 'PENDING', 'FAILED'],
    },
    apiResponseStatusCode: { column: 'ai.api_response_status_code', type: 'number' },
    createdDate: { column: 'ai.created_date', type: 'date' },
  },
};

export function listApInvoices(req: Request) {
  return runList<RowDataPacket>(req, listConfig, {
    selectSql: `SELECT ai.ap_invoice_id, ai.ap_invoice_number, ai.ap_paymentfile_id,
                       b.ap_batch_name, b.interface_id,
                       ai.created_date, ai.ap_invoice_api_status, ai.api_response_status_code`,
    fromSql: `
      FROM ap_invoices ai
      LEFT JOIN ap_payment_file_details b ON b.id = ai.ap_paymentfile_id`,
  });
}

export async function getApInvoice(id: number) {
  const row = await queryOne<RowDataPacket>(
    `SELECT ai.*, b.ap_batch_name, b.interface_id, b.ap_batch_status
       FROM ap_invoices ai
       LEFT JOIN ap_payment_file_details b ON b.id = ai.ap_paymentfile_id
      WHERE ai.ap_invoice_id = ?`,
    [id],
  );
  if (!row) return null;

  const invoiceNumber = row.ap_invoice_number as string;
  const [responseLogs, summary] = await Promise.all([
    query<RowDataPacket>(
      `SELECT log_id, invoice_number, request_url, http_status_code, is_success,
              response_message, error_message, created_datetime, invoice_process_uuid
         FROM invoice_response_log
        WHERE invoice_number = ?
        ORDER BY created_datetime DESC`,
      [invoiceNumber],
    ),
    queryOne<RowDataPacket>(
      'SELECT * FROM invoice_summary WHERE invoice_number = ? ORDER BY summary_id DESC LIMIT 1',
      [invoiceNumber],
    ),
  ]);

  return {
    ...row,
    api_response_obj: parseJsonColumn(row.api_response_obj),
    responseLogs,
    summary,
  };
}
