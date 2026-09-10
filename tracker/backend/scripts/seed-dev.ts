/**
 * Development seed: creates a small but complete dataset so every read screen in
 * the tracker has something to show — AP batches, process/response logs, and the
 * full invoice_summary -> detail -> line -> service -> charge tree.
 *
 * Safe to re-run: it only seeds tables that are empty (except ap_invoices, which
 * create_tables.sql already seeds and which this script re-points at the batches
 * it creates).
 *
 * Usage: npx tsx scripts/seed-dev.ts
 */
import { randomUUID } from 'node:crypto';
import { pool, closePool } from '../src/db/pool.js';
import { logger } from '../src/lib/logger.js';

async function count(table: string): Promise<number> {
  const [rows] = await pool.query<{ n: number }[] & import('mysql2').RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM ${table}`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function seed(): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // --- interface ---
    const [ifaceRows] = await conn.query<import('mysql2').RowDataPacket[]>(
      'SELECT InterfaceId FROM interfaceconfiguration ORDER BY InterfaceId LIMIT 1',
    );
    let interfaceId = ifaceRows[0]?.InterfaceId as number | undefined;
    if (!interfaceId) {
      const [ins] = await conn.query<import('mysql2').ResultSetHeader>(
        `INSERT INTO interfaceconfiguration (InterfaceName, IsActive, SFTP_Host, SMTP_Host, Platform_InstanceUrl, output_type)
         VALUES ('CBTS_AP', 1, 'sftp.example.com', 'smtp.example.com', 'https://gatewayinternal.testapps.com', 'csv')`,
      );
      interfaceId = ins.insertId;
      logger.info({ interfaceId }, 'seeded interfaceconfiguration');
    }

    // --- batches ---
    if ((await count('ap_payment_file_details')) === 0) {
      for (let i = 1; i <= 4; i += 1) {
        const paymentFileId = 1000 + i;
        const status = i === 1 ? 'Success' : i === 2 ? 'Failure' : 'New';
        await conn.query(
          `INSERT INTO ap_payment_file_details
             (ap_batch_name, ap_batch_payment_file_id, interface_id, ap_batch_status, processed_date)
           VALUES (?, ?, ?, ?, ?)`,
          [
            `CBTS_AP_BATCH_${paymentFileId}`,
            paymentFileId,
            interfaceId,
            status,
            status === 'New' ? null : new Date(),
          ],
        );
      }
      logger.info('seeded ap_payment_file_details (4 batches)');
    }

    // --- monthly spread of processed batches (for the dashboard chart) ---
    const [oldRows] = await conn.query<import('mysql2').RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM ap_payment_file_details
        WHERE processed_date IS NOT NULL AND processed_date < DATE_SUB(NOW(), INTERVAL 40 DAY)`,
    );
    if (Number(oldRows[0]?.n ?? 0) === 0) {
      let pf = 2000;
      // month offset -> [success, failure] counts
      const plan: [number, number][] = [
        [3, 1],
        [4, 0],
        [2, 2],
        [5, 1],
        [3, 0],
        [4, 2],
      ];
      for (let m = 0; m < plan.length; m += 1) {
        const [ok, fail] = plan[m]!;
        const monthOffset = plan.length - m; // oldest first
        for (let k = 0; k < ok + fail; k += 1) {
          pf += 1;
          const status = k < ok ? 'Success' : 'Failure';
          await conn.query(
            `INSERT INTO ap_payment_file_details
               (ap_batch_name, ap_batch_payment_file_id, interface_id, ap_batch_status, processed_date)
             VALUES (?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? MONTH) + INTERVAL ? DAY)`,
            [`CBTS_AP_BATCH_${pf}`, pf, interfaceId, status, monthOffset, k + 1],
          );
        }
      }
      logger.info('seeded monthly spread of processed batches');
    }

    const [batches] = await conn.query<import('mysql2').RowDataPacket[]>(
      'SELECT id, ap_batch_payment_file_id, ap_batch_status FROM ap_payment_file_details ORDER BY id',
    );

    // --- re-point ap_invoices at the seeded batches ---
    const [apInvoices] = await conn.query<import('mysql2').RowDataPacket[]>(
      'SELECT ap_invoice_id, ap_invoice_number FROM ap_invoices ORDER BY ap_invoice_id',
    );
    for (let idx = 0; idx < apInvoices.length; idx += 1) {
      const batch = batches[idx % batches.length]!;
      await conn.query('UPDATE ap_invoices SET ap_paymentfile_id = ? WHERE ap_invoice_id = ?', [
        batch.id,
        apInvoices[idx]!.ap_invoice_id,
      ]);
    }

    // --- process logs + response logs + invoice tree for the first (Success) batch ---
    if ((await count('ap_invoices_process_log')) === 0) {
      const successBatch = batches.find((b) => b.ap_batch_status === 'Success') ?? batches[0]!;
      const uuid = randomUUID();
      await conn.query(
        `INSERT INTO ap_invoices_process_log (proces_datetime, invoice_process_uuid, ap_payment_file_detail_id)
         VALUES (?, ?, ?)`,
        [new Date(), uuid, successBatch.id],
      );

      const [batchInvoices] = await conn.query<import('mysql2').RowDataPacket[]>(
        'SELECT ap_invoice_number FROM ap_invoices WHERE ap_paymentfile_id = ?',
        [successBatch.id],
      );

      let invoiceIdSeq = 5000;
      for (const bi of batchInvoices) {
        const invoiceNumber = bi.ap_invoice_number as string;
        const invoiceId = (invoiceIdSeq += 1);

        const [rl] = await conn.query<import('mysql2').ResultSetHeader>(
          `INSERT INTO invoice_response_log
             (invoice_number, request_url, http_status_code, is_success, response_message, response_body, invoice_process_uuid)
           VALUES (?, ?, 200, 1, 'OK', ?, ?)`,
          [
            invoiceNumber,
            `https://gatewayinternal.testapps.com/api/v2/invoices?invoiceNumber=${invoiceNumber}`,
            JSON.stringify({ success: true, data: { records: [{ invoiceId, invoiceNumber }] } }),
            uuid,
          ],
        );
        const logId = rl.insertId;

        await conn.query(
          `INSERT INTO invoice_summary
             (invoice_id, invoice_number, billing_date, due_date, invoice_created_date, account_number,
              account_id, total_amount_due, amount_to_pay, currency_symbol, account_service_type,
              log_id, invoice_process_uuid, ap_payment_file_detail_id)
           VALUES (?, ?, NOW(), NOW() + INTERVAL 30 DAY, NOW(), ?, ?, ?, ?, '$', 'Wireless', ?, ?, ?)`,
          [
            invoiceId,
            invoiceNumber,
            `ACCT-${invoiceId}`,
            invoiceId,
            1234.56,
            1234.56,
            logId,
            uuid,
            successBatch.id,
          ],
        );

        const [d] = await conn.query<import('mysql2').ResultSetHeader>(
          `INSERT INTO invoice_detail
             (invoice_id, invoice_number, organization, vendor_name, invoice_step, billing_date,
              due_date, account_number, current_charges, total_amount_due, amount_to_pay,
              currency_symbol, invoice_type, account_service_type, log_id)
           VALUES (?, ?, 'Acme Corp', 'CBTS', 'Approved', NOW(), NOW() + INTERVAL 30 DAY, ?, ?, ?, ?, '$', 'Standard', 'Wireless', ?)`,
          [invoiceId, invoiceNumber, `ACCT-${invoiceId}`, 1200.0, 1234.56, 1234.56, logId],
        );
        const detailId = d.insertId;

        const [ld] = await conn.query<import('mysql2').ResultSetHeader>(
          'INSERT INTO invoice_line_detail (detail_id, service_total_count) VALUES (?, ?)',
          [detailId, 2],
        );
        const lineDetailId = ld.insertId;

        for (let s = 1; s <= 2; s += 1) {
          const [sv] = await conn.query<import('mysql2').ResultSetHeader>(
            `INSERT INTO invoice_service
               (line_detail_id, service_index, api_invoice_detail_id, sakon_service_id, service_id, btn, sub_account_number)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [lineDetailId, s, detailId, 900 + s, `SVC-${invoiceId}-${s}`, `555000${s}`, `SUB-${s}`],
          );
          const servicePk = sv.insertId;
          for (let ch = 1; ch <= 3; ch += 1) {
            await conn.query(
              `INSERT INTO invoice_charge
                 (service_pk, invoice_charge_usage_id, component1_type, component, description,
                  current_month_charges, previous_month_charges, inventory_charge, expected_rate,
                  usage_unit1_label, usage_unit1_value)
               VALUES (?, ?, 'Recurring', ?, ?, ?, ?, ?, ?, 'Minutes', ?)`,
              [
                servicePk,
                ch * 10,
                `Component ${ch}`,
                `Charge ${ch} for service ${s}`,
                100 * ch,
                95 * ch,
                5 * ch,
                0.0123,
                ch * 100,
              ],
            );
          }
        }
      }
      logger.info('seeded process log + response logs + invoice tree');
    }

    await conn.commit();
    logger.info('seed-dev complete');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

seed()
  .then(closePool)
  .catch(async (err) => {
    await closePool();
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
