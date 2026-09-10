import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  ColumnFiltersState,
  PaginationState,
  SortingState,
  Updater,
} from '@tanstack/react-table';

export interface DataGridState {
  pagination: PaginationState;
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  globalFilter: string;
}

export interface UseDataGridOptions {
  /** URL param namespace so multiple grids can coexist on one page. */
  prefix?: string;
  defaultSort?: { id: string; desc: boolean };
  defaultPageSize?: number;
}

function readNumber(sp: URLSearchParams, key: string, fallback: number): number {
  const raw = sp.get(key);
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface UseDataGridResult {
  state: DataGridState;
  setPagination: (u: Updater<PaginationState>) => void;
  setSorting: (u: Updater<SortingState>) => void;
  setColumnFilters: (u: Updater<ColumnFiltersState>) => void;
  setGlobalFilter: (value: string) => void;
  /** Query params for the list API (page is 1-indexed for the backend). */
  apiParams: Record<string, string | number | undefined>;
}

export function useDataGrid(options: UseDataGridOptions = {}): UseDataGridResult {
  const { prefix = '', defaultSort, defaultPageSize = 25 } = options;
  const p = prefix ? `${prefix}_` : '';
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo<DataGridState>(() => {
    const pageIndex = readNumber(searchParams, `${p}page`, 1) - 1;
    const pageSize = readNumber(searchParams, `${p}size`, defaultPageSize);
    const sortRaw = searchParams.get(`${p}sort`);
    const sorting: SortingState = sortRaw
      ? [{ id: sortRaw.replace(/^-/, ''), desc: sortRaw.startsWith('-') }]
      : defaultSort
        ? [defaultSort]
        : [];
    const globalFilter = searchParams.get(`${p}q`) ?? '';

    const columnFilters: ColumnFiltersState = [];
    searchParams.forEach((value, key) => {
      if (key.startsWith(`${p}f_`)) {
        columnFilters.push({ id: key.slice(`${p}f_`.length), value });
      }
    });

    return { pagination: { pageIndex, pageSize }, sorting, columnFilters, globalFilter };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, p, defaultPageSize]);

  const mutate = (fn: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    fn(next);
    setSearchParams(next, { replace: true });
  };

  const setPagination = (u: Updater<PaginationState>) => {
    const value = typeof u === 'function' ? u(state.pagination) : u;
    mutate((next) => {
      next.set(`${p}page`, String(value.pageIndex + 1));
      next.set(`${p}size`, String(value.pageSize));
    });
  };

  const setSorting = (u: Updater<SortingState>) => {
    const value = typeof u === 'function' ? u(state.sorting) : u;
    mutate((next) => {
      if (value.length === 0) {
        next.delete(`${p}sort`);
      } else {
        const s = value[0]!;
        next.set(`${p}sort`, `${s.desc ? '-' : ''}${s.id}`);
      }
      next.set(`${p}page`, '1');
    });
  };

  const setColumnFilters = (u: Updater<ColumnFiltersState>) => {
    const value = typeof u === 'function' ? u(state.columnFilters) : u;
    mutate((next) => {
      Array.from(next.keys())
        .filter((k) => k.startsWith(`${p}f_`))
        .forEach((k) => next.delete(k));
      for (const f of value) {
        if (f.value !== undefined && f.value !== '') next.set(`${p}f_${f.id}`, String(f.value));
      }
      next.set(`${p}page`, '1');
    });
  };

  const setGlobalFilter = (value: string) => {
    mutate((next) => {
      if (value) next.set(`${p}q`, value);
      else next.delete(`${p}q`);
      next.set(`${p}page`, '1');
    });
  };

  const apiParams = useMemo(() => {
    const params: Record<string, string | number | undefined> = {
      page: state.pagination.pageIndex + 1,
      pageSize: state.pagination.pageSize,
    };
    if (state.sorting[0]) {
      params.sort = state.sorting[0].id;
      params.order = state.sorting[0].desc ? 'desc' : 'asc';
    }
    if (state.globalFilter) params.q = state.globalFilter;
    for (const f of state.columnFilters) {
      params[`filter.${f.id}`] = String(f.value);
    }
    return params;
  }, [state]);

  return { state, setPagination, setSorting, setColumnFilters, setGlobalFilter, apiParams };
}
