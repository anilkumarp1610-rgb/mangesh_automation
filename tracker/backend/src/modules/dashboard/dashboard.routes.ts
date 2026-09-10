import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { batchesByMonth } from './dashboard.repo.js';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/batches-by-month',
  asyncHandler(async (req, res) => {
    const months = Number(req.query.months ?? 12);
    res.json(await batchesByMonth(months));
  }),
);
