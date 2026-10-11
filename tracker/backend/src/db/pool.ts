import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export const pool: Pool = mysql.createPool({
  host: env.MYSQL_HOST,
  port: env.MYSQL_PORT,
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: env.MYSQL_DATABASE,
  connectionLimit: env.MYSQL_CONNECTION_LIMIT,
  waitForConnections: true,
  enableKeepAlive: true,
  dateStrings: true, // return DATETIME as strings; the frontend formats them
  namedPlaceholders: false,
  timezone: 'Z',
});

/** SELECT returning multiple rows. */
export async function query<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query<T[]>(sql, params);
  return rows;
}

/** SELECT returning a single row (or null). */
export async function queryOne<T extends RowDataPacket>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Returns the COUNT(*) of a `SELECT ... FROM ... [WHERE ...]` by wrapping it. */
export async function countRows(fromWhereSql: string, params: unknown[] = []): Promise<number> {
  const rows = await query<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total ${fromWhereSql}`,
    params,
  );
  return Number(rows[0]?.total ?? 0);
}

export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function assertDbReachable(): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    logger.info({ host: env.MYSQL_HOST, db: env.MYSQL_DATABASE }, 'Connected to MySQL');
  } finally {
    conn.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
