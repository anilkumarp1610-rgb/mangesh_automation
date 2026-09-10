import * as React from 'react';
import { cn } from '@/lib/utils';

export interface Field {
  label: string;
  value: React.ReactNode;
}

export function FieldList({
  fields,
  columns = 2,
  className,
}: {
  fields: Field[];
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-3 text-sm',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {fields.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</dt>
          <dd className="mt-0.5 break-words font-medium">{f.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Renders every own-key of a record as a field, skipping nested objects/arrays. */
export function recordToFields(
  row: Record<string, unknown> | null | undefined,
  format?: (key: string, value: unknown) => React.ReactNode,
): Field[] {
  if (!row) return [];
  return Object.entries(row)
    .filter(([, v]) => v === null || typeof v !== 'object')
    .map(([key, value]) => ({
      label: key,
      value: format ? format(key, value) : value === null || value === '' ? '—' : String(value),
    }));
}
