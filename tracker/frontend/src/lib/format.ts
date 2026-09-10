import { format, parseISO, isValid } from 'date-fns';

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  // mysql2 dateStrings gives "YYYY-MM-DD HH:mm:ss"
  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'yyyy-MM-dd HH:mm:ss') : value;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'yyyy-MM-dd') : value;
}

export function formatNumber(value: number | string | null | undefined, digits = 0): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatCurrency(
  value: number | string | null | undefined,
  symbol = '',
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return String(value);
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function truncate(value: string | null | undefined, max = 60): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
