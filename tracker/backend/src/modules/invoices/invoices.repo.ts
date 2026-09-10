import type { Request } from 'express';
import type { RowDataPacket } from 'mysql2';
import { query, queryOne } from '../../db/pool.js';
import { runList } from '../../lib/list.js';
import type { ListConfig } from '../../lib/listQuery.js';

/** Invoice Explorer main grid: invoice_summary enriched from invoice_detail. */
export const listConfig: ListConfig = {
  defaultSort: { field: 'fetchedDatetime', order: 'desc' },
  fields: {
    invoiceId: { column: 's.invoice_id', type: 'number' },
    invoiceNumber: { column: 's.invoice_number', type: 'string' },
    accountNumber: { column: 's.account_number', type: 'string' },
    organization: { column: 'd.organization', type: 'string' },
    vendorName: { column: 'd.vendor_name', type: 'string' },
    invoiceStep: { column: 'd.invoice_step', type: 'string' },
    accountServiceType: { column: 's.account_service_type', type: 'string' },
    totalAmountDue: { column: 's.total_amount_due', type: 'number' },
    amountToPay: { column: 's.amount_to_pay', type: 'number' },
    billingDate: { column: 's.billing_date', type: 'date' },
    dueDate: { column: 's.due_date', type: 'date' },
    invoiceProcessUuid: { column: 's.invoice_process_uuid', type: 'string' },
    apPaymentFileDetailId: { column: 's.ap_payment_file_detail_id', type: 'number' },
    fetchedDatetime: { column: 's.fetched_datetime', type: 'date' },
  },
};

const FROM = `
  FROM invoice_summary s
  LEFT JOIN invoice_detail d ON d.invoice_id = s.invoice_id`;

export function listInvoices(req: Request) {
  return runList<RowDataPacket>(req, listConfig, {
    selectSql: `SELECT s.summary_id, s.invoice_id, s.invoice_number, s.account_number,
                       d.organization, d.vendor_name, d.invoice_step,
                       s.account_service_type, s.total_amount_due, s.amount_to_pay, s.currency_symbol,
                       s.billing_date, s.due_date, s.invoice_process_uuid,
                       s.ap_payment_file_detail_id, s.fetched_datetime`,
    fromSql: FROM,
  });
}

export async function getInvoice(invoiceId: number) {
  const summary = await queryOne<RowDataPacket>('SELECT * FROM invoice_summary WHERE invoice_id = ?', [
    invoiceId,
  ]);
  const detail = await queryOne<RowDataPacket>('SELECT * FROM invoice_detail WHERE invoice_id = ?', [
    invoiceId,
  ]);
  if (!summary && !detail) return null;

  const invoiceNumber = (summary?.invoice_number ?? detail?.invoice_number) as string;
  const detailId = detail?.detail_id as number | undefined;
  const batchId = summary?.ap_payment_file_detail_id as number | undefined;

  const [counts, batch, responseLogs] = await Promise.all([
    detailId
      ? queryOne<RowDataPacket>(
          `SELECT
             (SELECT COUNT(*) FROM invoice_line_detail ld WHERE ld.detail_id = ?) AS line_count,
             (SELECT COUNT(*) FROM invoice_service sv
                JOIN invoice_line_detail ld ON ld.line_detail_id = sv.line_detail_id
               WHERE ld.detail_id = ?) AS service_count,
             (SELECT COUNT(*) FROM invoice_charge ch
                JOIN invoice_service sv ON sv.service_pk = ch.service_pk
                JOIN invoice_line_detail ld ON ld.line_detail_id = sv.line_detail_id
               WHERE ld.detail_id = ?) AS charge_count`,
          [detailId, detailId, detailId],
        )
      : Promise.resolve(null),
    batchId
      ? queryOne<RowDataPacket>(
          `SELECT b.id, b.ap_batch_name, b.ap_batch_status, b.interface_id,
                  i.InterfaceName AS interface_name
             FROM ap_payment_file_details b
             LEFT JOIN interfaceconfiguration i ON i.InterfaceId = b.interface_id
            WHERE b.id = ?`,
          [batchId],
        )
      : Promise.resolve(null),
    query<RowDataPacket>(
      `SELECT log_id, request_url, http_status_code, is_success, response_message,
              error_message, created_datetime, invoice_process_uuid
         FROM invoice_response_log WHERE invoice_number = ?
        ORDER BY created_datetime DESC`,
      [invoiceNumber],
    ),
  ]);

  return { invoiceId, invoiceNumber, summary, detail, counts, batch, responseLogs };
}

/** line_detail -> service -> charge, nested. */
export async function getInvoiceTree(invoiceId: number) {
  const detail = await queryOne<RowDataPacket>(
    'SELECT detail_id FROM invoice_detail WHERE invoice_id = ?',
    [invoiceId],
  );
  if (!detail) return { lines: [] };
  const detailId = detail.detail_id as number;

  const [lines, services, charges] = await Promise.all([
    query<RowDataPacket>(
      'SELECT * FROM invoice_line_detail WHERE detail_id = ? ORDER BY line_detail_id',
      [detailId],
    ),
    query<RowDataPacket>(
      `SELECT sv.* FROM invoice_service sv
         JOIN invoice_line_detail ld ON ld.line_detail_id = sv.line_detail_id
        WHERE ld.detail_id = ? ORDER BY sv.line_detail_id, sv.service_index`,
      [detailId],
    ),
    query<RowDataPacket>(
      `SELECT ch.* FROM invoice_charge ch
         JOIN invoice_service sv ON sv.service_pk = ch.service_pk
         JOIN invoice_line_detail ld ON ld.line_detail_id = sv.line_detail_id
        WHERE ld.detail_id = ? ORDER BY ch.service_pk, ch.charge_pk`,
      [detailId],
    ),
  ]);

  const chargesByService = new Map<number, RowDataPacket[]>();
  for (const c of charges) {
    const key = c.service_pk as number;
    if (!chargesByService.has(key)) chargesByService.set(key, []);
    chargesByService.get(key)!.push(c);
  }
  const servicesByLine = new Map<number, unknown[]>();
  for (const s of services) {
    const key = s.line_detail_id as number;
    if (!servicesByLine.has(key)) servicesByLine.set(key, []);
    servicesByLine
      .get(key)!
      .push({ ...s, charges: chargesByService.get(s.service_pk as number) ?? [] });
  }

  return {
    lines: lines.map((l) => ({
      ...l,
      services: servicesByLine.get(l.line_detail_id as number) ?? [],
    })),
  };
}
