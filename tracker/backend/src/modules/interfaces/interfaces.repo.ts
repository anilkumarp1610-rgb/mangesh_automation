import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { Request } from 'express';
import { pool, query, queryOne } from '../../db/pool.js';
import { encryptSecret, isEncryptionConfigured } from '../../crypto/secrets.js';
import { AppError } from '../../lib/errors.js';
import { runList } from '../../lib/list.js';
import type { ListConfig } from '../../lib/listQuery.js';
import type { InterfaceCreateInput, InterfaceUpdateInput } from './interfaces.schema.js';

export const SECRET_COLUMNS = [
  'SFTP_Password',
  'SMTP_Password',
  'Platform_Password',
  'Platform_AppAuthKey',
  'Platform_DB_Password',
] as const;

const BOOLEAN_COLUMNS = new Set([
  'SMTP_UseTLS',
  'IsActive',
  'Email_Enabled',
  'Email_Attachment_Enabled',
  'Failure_Notification_Enabled',
  'output_combined',
]);

export const listConfig: ListConfig = {
  defaultSort: { field: 'interfaceName', order: 'asc' },
  fields: {
    interfaceId: { column: 'i.InterfaceId', type: 'number' },
    interfaceName: { column: 'i.InterfaceName', type: 'string' },
    isActive: { column: 'i.IsActive', type: 'bool' },
    sftpHost: { column: 'i.SFTP_Host', type: 'string' },
    smtpHost: { column: 'i.SMTP_Host', type: 'string' },
    platformInstanceUrl: { column: 'i.Platform_InstanceUrl', type: 'string' },
    outputType: { column: 'i.output_type', type: 'string' },
    createdDate: { column: 'i.CreatedDate', type: 'date' },
    modifiedDate: { column: 'i.ModifiedDate', type: 'date' },
  },
};

export function listInterfaces(req: Request) {
  return runList<RowDataPacket>(req, listConfig, {
    selectSql: `
      SELECT i.InterfaceId, i.InterfaceName, i.IsActive,
             i.SFTP_Host, i.SFTP_RemoteDirectory,
             i.SMTP_Host, i.SMTP_Port,
             i.Platform_InstanceUrl, i.Platform_DB_Name,
             i.Output_Directory, i.Archive_Directory, i.output_type, i.output_combined,
             i.Email_Enabled, i.Failure_Notification_Enabled,
             i.CreatedDate, i.ModifiedDate,
             (SELECT COUNT(*) FROM ap_payment_file_details b
                WHERE b.interface_id = i.InterfaceId) AS batchCount`,
    fromSql: 'FROM interfaceconfiguration i',
  });
}

export async function getInterface(id: number) {
  const row = await queryOne<RowDataPacket>(
    'SELECT * FROM interfaceconfiguration WHERE InterfaceId = ?',
    [id],
  );
  if (!row) return null;
  // P2 is read-only: never ship secret values. Report only whether each is set.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if ((SECRET_COLUMNS as readonly string[]).includes(k)) {
      out[`${k}_isSet`] = v !== null && v !== '';
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function interfaceOptions() {
  return query<RowDataPacket>(
    'SELECT InterfaceId, InterfaceName, IsActive FROM interfaceconfiguration ORDER BY InterfaceName',
  );
}

const SECRET_SET: ReadonlySet<string> = new Set(SECRET_COLUMNS);

/** Turns a validated payload into a column→value map ready for INSERT/UPDATE. */
function buildRow(input: Record<string, unknown>): Record<string, unknown> {
  const writingSecret = SECRET_COLUMNS.some(
    (c) => typeof input[c] === 'string' && (input[c] as string).length > 0,
  );
  if (writingSecret && !isEncryptionConfigured()) {
    throw new AppError(
      400,
      'encryption_not_configured',
      'INTERFACE_SECRET_KEY is not set — cannot store interface secrets. Configure it (and give the same key to the Python pipeline) before saving passwords.',
    );
  }

  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (SECRET_SET.has(key)) {
      row[key] = encryptSecret(value as string);
    } else if (BOOLEAN_COLUMNS.has(key)) {
      row[key] = value ? 1 : 0;
    } else {
      row[key] = value;
    }
  }
  return row;
}

function isDuplicateName(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}

export async function createInterface(input: InterfaceCreateInput) {
  const row = buildRow(input);
  const cols = Object.keys(row);
  const sql = `INSERT INTO interfaceconfiguration (${cols.map((c) => `\`${c}\``).join(', ')})
               VALUES (${cols.map(() => '?').join(', ')})`;
  try {
    const [res] = await pool.query<ResultSetHeader>(sql, Object.values(row));
    return getInterface(res.insertId);
  } catch (err) {
    if (isDuplicateName(err)) {
      throw new AppError(409, 'duplicate', `An interface named "${input.InterfaceName}" already exists`);
    }
    throw err;
  }
}

export async function updateInterface(id: number, input: InterfaceUpdateInput) {
  const existing = await queryOne<RowDataPacket>(
    'SELECT InterfaceId FROM interfaceconfiguration WHERE InterfaceId = ?',
    [id],
  );
  if (!existing) return null;

  const row = buildRow(input);
  row.ModifiedDate = new Date();
  const cols = Object.keys(row);
  const sql = `UPDATE interfaceconfiguration SET ${cols
    .map((c) => `\`${c}\` = ?`)
    .join(', ')} WHERE InterfaceId = ?`;
  try {
    await pool.query(sql, [...Object.values(row), id]);
  } catch (err) {
    if (isDuplicateName(err)) {
      throw new AppError(409, 'duplicate', `An interface with that name already exists`);
    }
    throw err;
  }
  return getInterface(id);
}

export async function setInterfaceActive(id: number, isActive: boolean) {
  const [res] = await pool.query<ResultSetHeader>(
    'UPDATE interfaceconfiguration SET IsActive = ?, ModifiedDate = ? WHERE InterfaceId = ?',
    [isActive ? 1 : 0, new Date(), id],
  );
  if (res.affectedRows === 0) return null;
  return getInterface(id);
}
