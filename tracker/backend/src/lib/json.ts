/**
 * mysql2 returns JSON columns already parsed, but LONGTEXT columns that hold JSON
 * (e.g. ap_invoices.api_response_obj on older schemas) come back as strings.
 * Normalise both to a value, leaving non-JSON strings untouched.
 */
export function parseJsonColumn(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[[{"]/.test(trimmed) && !/^-?\d/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}
