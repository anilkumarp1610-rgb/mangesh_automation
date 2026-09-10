import type { Request } from 'express';
import { ValidationError } from './errors.js';

export type FilterType = 'string' | 'number' | 'date' | 'bool' | 'enum';

export interface FieldConfig {
  /** Fully-qualified SQL expression this client field maps to, e.g. "b.ap_batch_status". */
  column: string;
  type: FilterType;
  /** Allowed values when type === 'enum'. */
  values?: readonly string[];
  sortable?: boolean;
  filterable?: boolean;
}

export interface ListConfig {
  fields: Record<string, FieldConfig>;
  defaultSort: { field: string; order: 'asc' | 'desc' };
  maxPageSize?: number;
}

export interface ParsedList {
  page: number;
  pageSize: number;
  limit: number;
  offset: number;
  orderBySql: string;
  whereSql: string;
  params: unknown[];
}

const OPS = ['eq', 'ne', 'like', 'gte', 'lte', 'gt', 'lt', 'in'] as const;
type Op = (typeof OPS)[number];

function coerce(type: FilterType, raw: string): unknown {
  switch (type) {
    case 'number':
      return Number(raw);
    case 'bool':
      return /^(1|true|yes|on)$/i.test(raw) ? 1 : 0;
    default:
      return raw;
  }
}

/**
 * Parses ?page&pageSize&sort&order&filter.<field>[.<op>]=<value> into safe SQL
 * fragments. Field names and sort columns are validated against `config.fields`,
 * so no client-supplied identifier is ever concatenated into SQL.
 */
export function parseListQuery(req: Request, config: ListConfig): ParsedList {
  const q = req.query as Record<string, string | undefined>;
  const maxPageSize = config.maxPageSize ?? 200;

  const page = Math.max(1, Number.parseInt(q.page ?? '1', 10) || 1);
  const pageSize = Math.min(
    maxPageSize,
    Math.max(1, Number.parseInt(q.pageSize ?? '25', 10) || 25),
  );

  // --- sort ---
  const sortField = q.sort ?? config.defaultSort.field;
  const sortSpec = config.fields[sortField];
  if (!sortSpec || sortSpec.sortable === false) {
    throw new ValidationError(`Cannot sort by "${sortField}"`);
  }
  const order = (q.order ?? config.defaultSort.order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const orderBySql = `ORDER BY ${sortSpec.column} ${order}`;

  // --- filters ---
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const [key, rawValue] of Object.entries(q)) {
    if (!key.startsWith('filter.') || rawValue === undefined || rawValue === '') continue;
    const rest = key.slice('filter.'.length);
    const parts = rest.split('.');
    let op: Op = 'eq';
    let field = rest;
    if (parts.length > 1 && OPS.includes(parts[parts.length - 1] as Op)) {
      op = parts.pop() as Op;
      field = parts.join('.');
    }
    const spec = config.fields[field];
    if (!spec || spec.filterable === false) {
      throw new ValidationError(`Cannot filter by "${field}"`);
    }
    if (spec.type === 'enum' && spec.values && op === 'eq' && !spec.values.includes(rawValue)) {
      throw new ValidationError(`Invalid value for "${field}"`);
    }

    switch (op) {
      case 'like':
        clauses.push(`${spec.column} LIKE ?`);
        params.push(`%${rawValue}%`);
        break;
      case 'in': {
        const items = rawValue.split(',').map((s) => s.trim()).filter(Boolean);
        if (items.length === 0) break;
        clauses.push(`${spec.column} IN (${items.map(() => '?').join(', ')})`);
        params.push(...items.map((i) => coerce(spec.type, i)));
        break;
      }
      case 'ne':
        clauses.push(`${spec.column} <> ?`);
        params.push(coerce(spec.type, rawValue));
        break;
      case 'gte':
        clauses.push(`${spec.column} >= ?`);
        params.push(coerce(spec.type, rawValue));
        break;
      case 'lte':
        clauses.push(`${spec.column} <= ?`);
        params.push(coerce(spec.type, rawValue));
        break;
      case 'gt':
        clauses.push(`${spec.column} > ?`);
        params.push(coerce(spec.type, rawValue));
        break;
      case 'lt':
        clauses.push(`${spec.column} < ?`);
        params.push(coerce(spec.type, rawValue));
        break;
      default:
        if (spec.type === 'string') {
          clauses.push(`${spec.column} LIKE ?`);
          params.push(`%${rawValue}%`);
        } else {
          clauses.push(`${spec.column} = ?`);
          params.push(coerce(spec.type, rawValue));
        }
    }
  }

  // free-text search across all string fields via ?q=
  if (q.q) {
    const searchable = Object.values(config.fields).filter(
      (f) => f.type === 'string' && f.filterable !== false,
    );
    if (searchable.length) {
      clauses.push(`(${searchable.map((f) => `${f.column} LIKE ?`).join(' OR ')})`);
      searchable.forEach(() => params.push(`%${q.q}%`));
    }
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  return {
    page,
    pageSize,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    orderBySql,
    whereSql,
    params,
  };
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export function paginated<T>(data: T[], total: number, parsed: ParsedList): Paginated<T> {
  return {
    data,
    pagination: {
      page: parsed.page,
      pageSize: parsed.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / parsed.pageSize)),
    },
  };
}
