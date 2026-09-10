import type { Request } from 'express';
import type { RowDataPacket } from 'mysql2';
import { countRows, query } from '../db/pool.js';
import { type ListConfig, type Paginated, paginated, parseListQuery } from './listQuery.js';

export interface RunListOptions {
  /** Column list, e.g. "SELECT b.*, i.InterfaceName". */
  selectSql: string;
  /** "FROM ap_payment_file_details b LEFT JOIN interfaceconfiguration i ON ...". */
  fromSql: string;
  /** Extra always-on filter (e.g. scoping to a parent id). */
  scope?: { sql: string; params: unknown[] };
  /** Optional GROUP BY / HAVING appended before ORDER BY. */
  groupBySql?: string;
}

/**
 * Executes a paginated list query: one COUNT(*) + one page of rows, with sort and
 * filters parsed and validated against `config`.
 */
export async function runList<T extends RowDataPacket>(
  req: Request,
  config: ListConfig,
  opts: RunListOptions,
): Promise<Paginated<T>> {
  const parsed = parseListQuery(req, config);

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.scope) {
    clauses.push(opts.scope.sql);
    params.push(...opts.scope.params);
  }
  if (parsed.whereSql) {
    clauses.push(parsed.whereSql.replace(/^WHERE\s+/i, ''));
    params.push(...parsed.params);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const group = opts.groupBySql ?? '';

  let total: number;
  if (group) {
    const countRowsResult = await query<RowDataPacket & { c: number }>(
      `SELECT COUNT(*) AS c FROM (SELECT 1 ${opts.fromSql} ${whereSql} ${group}) t`,
      params,
    );
    total = Number(countRowsResult[0]?.c ?? 0);
  } else {
    total = await countRows(`${opts.fromSql} ${whereSql}`, params);
  }

  const rows = await query<T>(
    `${opts.selectSql} ${opts.fromSql} ${whereSql} ${group} ${parsed.orderBySql} LIMIT ? OFFSET ?`,
    [...params, parsed.limit, parsed.offset],
  );

  return paginated(rows, total, parsed);
}
