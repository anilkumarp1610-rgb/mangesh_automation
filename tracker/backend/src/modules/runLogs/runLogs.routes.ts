import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { getRunLog, listProcessLogs, listRunLogs } from './runLogs.repo.js';

export const runLogsRouter = Router();

function intParam(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ValidationError(`${name} must be an integer`);
  return n;
}

runLogsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listRunLogs(req));
  }),
);

runLogsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, 'id');
    const runLog = await getRunLog(id);
    if (!runLog) throw new NotFoundError('Run log', id);
    res.json({ data: runLog });
  }),
);

runLogsRouter.get(
  '/:id/process-logs',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, 'id');
    res.json(await listProcessLogs(req, id));
  }),
);
