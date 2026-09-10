import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { getBatch, listBatchInvoices, listBatches } from './apBatches.repo.js';

export const apBatchesRouter = Router();

function intParam(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ValidationError(`${name} must be an integer`);
  return n;
}

apBatchesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listBatches(req));
  }),
);

apBatchesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, 'id');
    const batch = await getBatch(id);
    if (!batch) throw new NotFoundError('AP batch', id);
    res.json({ data: batch });
  }),
);

apBatchesRouter.get(
  '/:id/invoices',
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id, 'id');
    res.json(await listBatchInvoices(req, id));
  }),
);
