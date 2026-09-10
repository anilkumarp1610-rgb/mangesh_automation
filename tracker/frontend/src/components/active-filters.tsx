import { X } from 'lucide-react';
import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';

export interface ActiveFilterSpec {
  /** URL search param that carries the filter (e.g. "f_interfaceId"). */
  param: string;
  /** Renders the chip label from the raw param value. */
  label: (value: string) => React.ReactNode;
  /** Param to reset to page 1 when this filter is cleared. */
  pageParam?: string;
}

/** Removable chips for drill-down filters that arrived via the URL. */
export function ActiveFilters({ specs }: { specs: ActiveFilterSpec[] }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = specs.filter((s) => searchParams.get(s.param));
  if (active.length === 0) return null;

  const clear = (spec: ActiveFilterSpec) => {
    const next = new URLSearchParams(searchParams);
    next.delete(spec.param);
    if (spec.pageParam) next.set(spec.pageParam, '1');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Filtered:</span>
      {active.map((spec) => (
        <Badge key={spec.param} variant="secondary" className="gap-1 pl-2 pr-1">
          {spec.label(searchParams.get(spec.param)!)}
          <button
            type="button"
            className="rounded-sm p-0.5 hover:bg-background/60"
            onClick={() => clear(spec)}
            aria-label="Clear filter"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
