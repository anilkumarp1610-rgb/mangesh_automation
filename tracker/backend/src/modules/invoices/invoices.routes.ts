import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { getInvoice, getInvoiceTree, listInvoices } from './invoices.repo.js';

export const invoicesRouter = Router();

function invoiceIdParam(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ValidationError('invoiceId must be an integer');
  return n;
}

invoicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listInvoices(req));
  }),
);

invoicesRouter.get(
  '/:invoiceId',
  asyncHandler(async (req, res) => {
    const invoiceId = invoiceIdParam(req.params.invoiceId);
    const row = await getInvoice(invoiceId);
    if (!row) throw new NotFoundError('Invoice', invoiceId);
    res.json({ data: row });
  }),
);

invoicesRouter.get(
  '/:invoiceId/tree',
  asyncHandler(async (req, res) => {
    const invoiceId = invoiceIdParam(req.params.invoiceId);
    res.json({ data: await getInvoiceTree(invoiceId) });
  }),
);
