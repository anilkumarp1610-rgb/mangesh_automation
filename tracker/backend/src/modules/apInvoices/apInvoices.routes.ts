import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { getApInvoice, listApInvoices } from './apInvoices.repo.js';

export const apInvoicesRouter = Router();

apInvoicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listApInvoices(req));
  }),
);

apInvoicesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new ValidationError('id must be an integer');
    const row = await getApInvoice(id);
    if (!row) throw new NotFoundError('AP invoice', id);
    res.json({ data: row });
  }),
);
