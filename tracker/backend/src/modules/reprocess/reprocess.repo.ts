import { spawn } from 'node:child_process';
import path from 'node:path';
import type { RowDataPacket } from 'mysql2';
import { env } from '../../config/env.js';
import { queryOne } from '../../db/pool.js';
import { NotFoundError, UpstreamError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

interface BatchRef extends RowDataPacket {
  id: number;
  interface_id: number | null;
  ap_batch_name: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Triggers `process_invoices.py --interface-id <id> --ap-batch-name <name>`
 * for one AP batch (re-pulls that batch + its invoices, regenerates the CSV,
 * uploads to SFTP, and sends the run-summary email -- same as any other run).
 *
 * Security: interface_id/ap_batch_name are never taken from the request body
 * -- they're read from the batch's own DB row, then passed to spawn() as
 * discrete argv entries (never a shell string), so nothing client-controlled
 * ever reaches a shell for interpretation.
 *
 * The child runs detached from this request (fire-and-forget): the pipeline
 * inserts and commits its own ap_run_log row as the very first thing it does
 * (see scripts/process_invoices.py::main()), so instead of re-implementing
 * that insert here, this polls for that new row (identified by its
 * auto-increment id being greater than whatever the latest one was for this
 * interface+batch before we spawned -- immune to clock skew between this
 * server and the DB server, unlike comparing wall-clock timestamps) and
 * returns its id so the UI can jump straight to that run's live log view.
 * If the row doesn't show up within PIPELINE_TRIGGER_POLL_TIMEOUT_MS, the
 * request fails but the spawned process is NOT killed -- it keeps running
 * independently either way.
 */
export async function reprocessBatch(batchId: number): Promise<{ runLogId: number; pid: number | null }> {
  const batch = await queryOne<BatchRef>(
    `SELECT id, interface_id, ap_batch_name FROM ap_payment_file_details WHERE id = ?`,
    [batchId],
  );
  if (!batch) throw new NotFoundError('AP batch', batchId);
  if (!batch.interface_id) {
    throw new ValidationError(`Batch ${batchId} has no interface_id -- cannot reprocess`);
  }
  if (!batch.ap_batch_name) {
    throw new ValidationError(`Batch ${batchId} has no ap_batch_name -- cannot reprocess`);
  }
  const interfaceId = batch.interface_id;
  const apBatchName = batch.ap_batch_name;

  const sinceRow = await queryOne<RowDataPacket & { maxId: number }>(
    `SELECT COALESCE(MAX(id), 0) AS maxId FROM ap_run_log
      WHERE interface_id = ? AND ap_batch_name = ?`,
    [interfaceId, apBatchName],
  );
  const sinceId = sinceRow?.maxId ?? 0;

  const args = [
    'process_invoices.py',
    '--interface-id',
    String(interfaceId),
    '--ap-batch-name',
    apBatchName,
  ];
  const cwd = path.resolve(process.cwd(), env.PIPELINE_SCRIPTS_DIR);

  logger.info({ batchId, interfaceId, apBatchName, cwd }, 'reprocess: spawning pipeline');

  const child = spawn(env.PIPELINE_PYTHON_EXECUTABLE, args, {
    cwd,
    stdio: 'ignore', // the pipeline's own logging goes to ap_process_log, not this process's stdio
  });
  child.unref(); // don't let this child keep the Node event loop / this request alive
  child.on('error', (err) => {
    logger.error({ err, batchId, interfaceId, apBatchName }, 'reprocess: failed to spawn pipeline process');
  });

  const deadline = Date.now() + env.PIPELINE_TRIGGER_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const runLog = await queryOne<RowDataPacket & { id: number }>(
      `SELECT id FROM ap_run_log
        WHERE interface_id = ? AND ap_batch_name = ? AND id > ?
        ORDER BY id ASC LIMIT 1`,
      [interfaceId, apBatchName, sinceId],
    );
    if (runLog) {
      logger.info({ batchId, runLogId: runLog.id, pid: child.pid }, 'reprocess: run started');
      return { runLogId: runLog.id, pid: child.pid ?? null };
    }
    await sleep(500);
  }

  throw new UpstreamError(
    `Triggered reprocessing for batch ${batchId}, but no ap_run_log row appeared within ` +
      `${env.PIPELINE_TRIGGER_POLL_TIMEOUT_MS}ms. The process may still be starting up ` +
      `(slow auth/DB connect) or failed before logging anything -- it was not killed and ` +
      `may still complete; check its host directly, or the batch's status shortly.`,
  );
}
