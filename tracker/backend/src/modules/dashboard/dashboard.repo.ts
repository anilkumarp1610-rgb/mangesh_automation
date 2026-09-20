import type { RowDataPacket } from 'mysql2';
import { query } from '../../db/pool.js';

const MONTH_LABEL = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' });

export interface MonthlyBatchRow {
  month: string; // 'YYYY-MM'
  monthLabel: string; // 'Apr 2026'
  new: number;
  success: number;
  failure: number;
  total: number;
}

/**
 * AP batches by calendar month, split New / Success / Failure. Success/Failure
 * batches are bucketed by processed_date (when the run finished); New batches
 * have no processed_date yet, so they're bucketed by fetched_datetime instead
 * (when the batch was first pulled in) -- COALESCE(processed_date,
 * fetched_datetime) picks whichever applies per row. The last `months` months
 * are always returned, zero-filled, so the series is continuous.
 */
export async function batchesByMonth(months: number): Promise<{
  data: MonthlyBatchRow[];
  totals: { new: number; success: number; failure: number; total: number; successRate: number };
}> {
  const span = Math.min(36, Math.max(1, Math.trunc(months) || 12));

  const rows = await query<RowDataPacket>(
    `SELECT DATE_FORMAT(COALESCE(processed_date, fetched_datetime), '%Y-%m') AS ym,
            SUM(ap_batch_status = 'New') AS new_count,
            SUM(ap_batch_status = 'Success') AS success,
            SUM(ap_batch_status = 'Failure') AS failure
       FROM ap_payment_file_details
      WHERE COALESCE(processed_date, fetched_datetime) IS NOT NULL
        AND COALESCE(processed_date, fetched_datetime)
              >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ? MONTH), '%Y-%m-01')
      GROUP BY ym`,
    [span - 1],
  );

  const byMonth = new Map(
    rows.map((r) => [
      String(r.ym),
      {
        new: Number(r.new_count ?? 0),
        success: Number(r.success ?? 0),
        failure: Number(r.failure ?? 0),
      },
    ]),
  );

  const data: MonthlyBatchRow[] = [];
  const now = new Date();
  for (let i = span - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const hit = byMonth.get(key) ?? { new: 0, success: 0, failure: 0 };
    data.push({
      month: key,
      monthLabel: MONTH_LABEL.format(d),
      new: hit.new,
      success: hit.success,
      failure: hit.failure,
      total: hit.new + hit.success + hit.failure,
    });
  }

  const newTotal = data.reduce((s, r) => s + r.new, 0);
  const success = data.reduce((s, r) => s + r.success, 0);
  const failure = data.reduce((s, r) => s + r.failure, 0);
  const processed = success + failure;

  return {
    data,
    totals: {
      new: newTotal,
      success,
      failure,
      total: newTotal + processed,
      successRate: processed ? Math.round((success / processed) * 1000) / 10 : 0,
    },
  };
}
