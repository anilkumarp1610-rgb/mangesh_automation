import { Router } from 'express';
import { pool } from '../db/pool.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { apBatchesRouter } from '../modules/apBatches/apBatches.routes.js';
import { apInvoicesRouter } from '../modules/apInvoices/apInvoices.routes.js';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes.js';
import { dataTablesRouter } from '../modules/dataTables/dataTables.routes.js';
import { interfacesRouter } from '../modules/interfaces/interfaces.routes.js';
import { invoicesRouter } from '../modules/invoices/invoices.routes.js';
import { responseLogsRouter } from '../modules/responseLogs/responseLogs.routes.js';

export const apiRouter = Router();

apiRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    let db = 'down';
    try {
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      db = 'up';
    } catch {
      db = 'down';
    }
    res.status(db === 'up' ? 200 : 503).json({ status: db === 'up' ? 'ok' : 'degraded', db });
  }),
);

apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/interfaces', interfacesRouter);
apiRouter.use('/ap-batches', apBatchesRouter);
apiRouter.use('/ap-invoices', apInvoicesRouter);
apiRouter.use('/response-logs', responseLogsRouter);
apiRouter.use('/invoices', invoicesRouter);
apiRouter.use('/tables', dataTablesRouter);
