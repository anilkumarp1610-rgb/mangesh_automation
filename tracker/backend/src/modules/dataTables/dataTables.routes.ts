import { Router } from 'express';
import type { RowDataPacket } from 'mysql2';
import { queryOne } from '../../db/pool.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { parseJsonColumn } from '../../lib/json.js';
import { runList } from '../../lib/list.js';
import { TABLES } from './registry.js';

export const dataTablesRouter = Router();

dataTablesRouter.get('/', (_req, res) => {
  res.json({
    data: Object.values(TABLES).map((t) => ({
      key: t.key,
      label: t.label,
      columns: Object.keys(t.listConfig.fields),
      pk: t.pk,
    })),
  });
});

dataTablesRouter.get(
  '/:table',
  asyncHandler(async (req, res) => {
    const def = TABLES[req.params.table ?? ''];
    if (!def) throw new NotFoundError('Table', req.params.table);
    res.json(
      await runList<RowDataPacket>(req, def.listConfig, {
        selectSql: `SELECT ${def.alias}.*`,
        fromSql: `FROM ${def.table} ${def.alias}`,
      }),
    );
  }),
);

dataTablesRouter.get(
  '/:table/:id',
  asyncHandler(async (req, res) => {
    const def = TABLES[req.params.table ?? ''];
    if (!def) throw new NotFoundError('Table', req.params.table);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new ValidationError('id must be an integer');
    const row = await queryOne<RowDataPacket>(
      `SELECT * FROM ${def.table} WHERE ${def.pk} = ?`,
      [id],
    );
    if (!row) throw new NotFoundError(def.label, id);
    for (const col of def.jsonColumns ?? []) {
      if (col in row) row[col] = parseJsonColumn(row[col]);
    }
    res.json({ data: row });
  }),
);
