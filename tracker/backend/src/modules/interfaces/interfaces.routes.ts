import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import {
  createInterface,
  getInterface,
  interfaceOptions,
  listInterfaces,
  setInterfaceActive,
  updateInterface,
} from './interfaces.repo.js';
import { activeSchema, interfaceCreateSchema, interfaceUpdateSchema } from './interfaces.schema.js';

export const interfacesRouter = Router();

function idParam(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id)) throw new ValidationError('id must be an integer');
  return id;
}

interfacesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listInterfaces(req));
  }),
);

interfacesRouter.get(
  '/options',
  asyncHandler(async (_req, res) => {
    res.json({ data: await interfaceOptions() });
  }),
);

interfacesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = interfaceCreateSchema.parse(req.body);
    const created = await createInterface(input);
    res.status(201).json({ data: created });
  }),
);

interfacesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const row = await getInterface(id);
    if (!row) throw new NotFoundError('Interface', id);
    res.json({ data: row });
  }),
);

interfacesRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const input = interfaceUpdateSchema.parse(req.body);
    const updated = await updateInterface(id, input);
    if (!updated) throw new NotFoundError('Interface', id);
    res.json({ data: updated });
  }),
);

interfacesRouter.patch(
  '/:id/active',
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const { isActive } = activeSchema.parse(req.body);
    const updated = await setInterfaceActive(id, isActive);
    if (!updated) throw new NotFoundError('Interface', id);
    res.json({ data: updated });
  }),
);
