import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Download,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { downloadCsv } from '@/lib/csv';
import { cn } from '@/lib/utils';
import type { Pagination } from '@/types/api';
import type { UseDataGridResult } from './use-data-grid';

interface DataGridProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[] | undefined;
  pagination: Pagination | undefined;
  grid: UseDataGridResult;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  onRefresh?: () => void;
  onRowClick?: (row: T) => void;
  getRowId?: (row: T) => string;
  searchPlaceholder?: string;
  exportFilename?: string;
  toolbarExtra?: React.ReactNode;
  emptyMessage?: string;
}

const PAGE_SIZES = [10, 25, 50, 100, 200];

export function DataGrid<T>({
  columns,
  data,
  pagination,
  grid,
  isLoading,
  isFetching,
  error,
  onRefresh,
  onRowClick,
  getRowId,
  searchPlaceholder = 'Search…',
  exportFilename = 'export',
  toolbarExtra,
  emptyMessage = 'No records found',
}: DataGridProps<T>) {
  const [searchDraft, setSearchDraft] = React.useState(grid.state.globalFilter);

  // keep a live handle so the debounced callback always sees the current URL state
  const gridRef = React.useRef(grid);
  gridRef.current = grid;

  // external → draft (URL back/forward, cleared filter)
  React.useEffect(() => setSearchDraft(grid.state.globalFilter), [grid.state.globalFilter]);

  // draft → applied filter, debounced so it filters as you type (no Enter needed)
  React.useEffect(() => {
    const trimmed = searchDraft.trim();
    if (trimmed === gridRef.current.state.globalFilter) return;
    const t = window.setTimeout(() => {
      gridRef.current.setGlobalFilter(trimmed);
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchDraft]);

  const table = useReactTable({
    data: data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: pagination?.totalPages ?? -1,
    state: {
      pagination: grid.state.pagination,
      sorting: grid.state.sorting,
      columnFilters: grid.state.columnFilters,
      globalFilter: grid.state.globalFilter,
    },
    onPaginationChange: grid.setPagination,
    onSortingChange: grid.setSorting,
    onColumnFiltersChange: grid.setColumnFilters,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
  });

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    grid.setGlobalFilter(searchDraft.trim());
  };

  const handleExport = () => {
    const visible = table.getVisibleLeafColumns().filter((c) => c.id !== 'actions');
    const headers = visible.map((c) => ({
      key: c.id,
      label: typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id,
    }));
    const rows = (data ?? []).map((row) => {
      const out: Record<string, unknown> = {};
      for (const c of visible) out[c.id] = (row as Record<string, unknown>)[c.id];
      return out;
    });
    downloadCsv(exportFilename, headers, rows);
  };

  const page = pagination?.page ?? 1;
  const totalPages = pagination?.totalPages ?? 1;
  const total = pagination?.total ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={submitSearch} className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-[240px] pl-8"
          />
        </form>
        {toolbarExtra}
        <div className="ml-auto flex items-center gap-2">
          {onRefresh && (
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={onRefresh}>
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!data?.length}>
            <Download className="mr-2 h-4 w-4" />
            CSV
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[400px] overflow-y-auto">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllLeafColumns()
                .filter((c) => c.getCanHide())
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(v) => column.toggleVisibility(!!v)}
                    className="capitalize"
                  >
                    {typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="relative overflow-x-auto rounded-md border scrollbar-thin">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={cn('whitespace-nowrap', canSort && 'cursor-pointer select-none')}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <div className="flex items-center gap-1">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort &&
                          (sorted === 'asc' ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                          ))}
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {table.getVisibleLeafColumns().map((c) => (
                    <TableCell key={c.id}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : error ? (
              <TableRow>
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className="h-24 text-center text-destructive"
                >
                  {error instanceof Error ? error.message : 'Failed to load data'}
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(onRowClick && 'cursor-pointer')}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="whitespace-nowrap">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <div>
          {total.toLocaleString()} record{total === 1 ? '' : 's'}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span>Rows</span>
            <Select
              value={String(grid.state.pagination.pageSize)}
              onValueChange={(v) =>
                grid.setPagination({ pageIndex: 0, pageSize: Number(v) })
              }
            >
              <SelectTrigger className="h-8 w-[72px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.setPageIndex(0)}
              disabled={page <= 1}
            >
              «
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={page <= 1}
            >
              ‹
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={page >= totalPages}
            >
              ›
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.setPageIndex(totalPages - 1)}
              disabled={page >= totalPages}
            >
              »
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
