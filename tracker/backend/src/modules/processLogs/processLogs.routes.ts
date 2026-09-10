import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { getProcessLog, listProcessLogs } from './processLogs.repo.js';

export const processLogsRouter = Router();

processLogsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listProcessLogs(req));
  }),
);

processLogsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new ValidationError('id must be an integer');
    const row = await getProcessLog(id);
    if (!row) throw new NotFoundError('Process log', id);
    res.json({ data: row });
  }),
);
