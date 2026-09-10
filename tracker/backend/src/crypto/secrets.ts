/**
 * AES-256-GCM encryption for the interfaceconfiguration secret columns
 * (SFTP_Password, SMTP_Password, Platform_Password, Platform_AppAuthKey,
 * Platform_DB_Password).
 *
 * Stored format:  enc:v1:<base64( iv[12] | authTag[16] | ciphertext )>
 *
 * The Python pipeline (scripts/repository.py) must implement the same scheme
 * with the same key (env INTERFACE_SECRET_KEY) so it can read these columns.
 * Values without the `enc:v1:` prefix are treated as legacy plaintext and
 * passed through unchanged, so encryption can be rolled out gradually.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const PREFIX = 'enc:v1:';
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = env.INTERFACE_SECRET_KEY;
  if (!raw) {
    throw new Error('INTERFACE_SECRET_KEY is not set — required for interface secret encryption');
  }
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }
  if (key.length !== 32) {
    throw new Error('INTERFACE_SECRET_KEY must decode to 32 bytes (AES-256)');
  }
  cachedKey = key;
  return key;
}

export function isEncryptionConfigured(): boolean {
  return Boolean(env.INTERFACE_SECRET_KEY);
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  if (isEncrypted(plaintext)) return plaintext;
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === '') return null;
  if (!isEncrypted(stored)) return stored; // legacy plaintext
  const key = loadKey();
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
