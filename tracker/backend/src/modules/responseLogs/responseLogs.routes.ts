import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { getResponseLog, listResponseLogs } from './responseLogs.repo.js';

export const responseLogsRouter = Router();

responseLogsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listResponseLogs(req));
  }),
);

responseLogsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new ValidationError('id must be an integer');
    const row = await getResponseLog(id);
    if (!row) throw new NotFoundError('Response log', id);
    res.json({ data: row });
  }),
);
