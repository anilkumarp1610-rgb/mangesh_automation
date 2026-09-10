/**
 * Minimal forward-only migration runner. Applies every *.sql file in
 * ../../migrations that has not yet been recorded in `tracker_migrations`.
 *
 * Usage: npm run migrate
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, closePool } from './pool.js';
import { logger } from '../lib/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../migrations');

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracker_migrations (
      name        VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
}

async function appliedSet(): Promise<Set<string>> {
  const [rows] = await pool.query<{ name: string }[] & import('mysql2').RowDataPacket[]>(
    'SELECT name FROM tracker_migrations',
  );
  return new Set(rows.map((r) => r.name));
}

async function run(): Promise<void> {
  await ensureTable();
  const applied = await appliedSet();
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.trim())
      .filter(Boolean);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const stmt of statements) {
        await conn.query(stmt);
      }
      await conn.query('INSERT INTO tracker_migrations (name) VALUES (?)', [file]);
      await conn.commit();
      logger.info({ file }, 'migration applied');
      count += 1;
    } catch (err) {
      await conn.rollback();
      logger.error({ file, err }, 'migration failed');
      throw err;
    } finally {
      conn.release();
    }
  }
  logger.info(count === 0 ? 'no pending migrations' : `${count} migration(s) applied`);
}

run()
  .then(() => closePool())
  .catch(async (err) => {
    await closePool();
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
