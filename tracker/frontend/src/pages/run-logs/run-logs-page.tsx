import type { ColumnDef } from '@tanstack/react-table';
import { format, startOfWeek } from 'date-fns';
import { Eye } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { DataGrid, useDataGrid } from '@/components/data-grid';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate, formatDateTime } from '@/lib/format';
import { useListQuery } from '@/lib/use-list';
import { RunLogProcessLogsSheet } from './run-log-process-logs-sheet';

interface RunLogRow {
  id: number;
  interface_id: number;
  interface_name: string | null;
  from_date: string | null;
  to_date: string | null;
  ap_batch_name: string | null;
  started_at: string;
  batch_count: number;
}

function windowLabel(row: RunLogRow): string {
  if (row.ap_batch_name) return row.ap_batch_name;
  if (row.from_date && row.to_date) {
    return row.from_date === row.to_date
      ? formatDate(row.from_date)
      : `${formatDate(row.from_date)} – ${formatDate(row.to_date)}`;
  }
  return 'Default lookback window';
}

// Default date-range filter: current week (Monday) through today.
const TODAY = format(new Date(), 'yyyy-MM-dd');
const WEEK_START = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

export function RunLogsPage() {
  const grid = useDataGrid({ defaultSort: { id: 'id', desc: true } });
  const navigate = useNavigate();
  const [logsRunId, setLogsRunId] = React.useState<number | null>(null);

  // started_at is a DATETIME with a real time-of-day component, so the "to"
  // bound carries 23:59:59 (set below) to stay inclusive of that whole day --
  // stripped back to YYYY-MM-DD here just for display.
  const dateFrom =
    (grid.state.columnFilters.find((f) => f.id === 'startedAt.gte')?.value as string) ?? '';
  const dateTo = (
    (grid.state.columnFilters.find((f) => f.id === 'startedAt.lte')?.value as string) ?? ''
  ).slice(0, 10);

  const setFilter = (id: string, value: string) => {
    const rest = grid.state.columnFilters.filter((f) => f.id !== id);
    grid.setColumnFilters(value ? [...rest, { id, value }] : rest);
  };

  // Seed the default date range (this week, Monday → today) once, only if the
  // URL doesn't already carry an explicit range (e.g. a shared link, or the
  // user navigating back after clearing it).
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (!dateFrom && !dateTo) {
      grid.setColumnFilters([
        ...grid.state.columnFilters,
        { id: 'startedAt.gte', value: WEEK_START },
        { id: 'startedAt.lte', value: `${TODAY} 23:59:59` },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = useListQuery<RunLogRow>('run-logs', '/run-logs', grid.apiParams);

  const columns = React.useMemo<ColumnDef<RunLogRow, unknown>[]>(
    () => [
      { accessorKey: 'id', header: 'Run ID', enableHiding: false },
      { accessorKey: 'interface_name', header: 'Interface' },
      {
        id: 'window',
        header: 'Parameters',
        cell: ({ row }) => <span className="text-sm">{windowLabel(row.original)}</span>,
      },
      {
        accessorKey: 'started_at',
        header: 'Started',
        cell: ({ getValue }) => formatDateTime(getValue() as string),
      },
      {
        accessorKey: 'batch_count',
        header: 'AP Batch Count',
        cell: ({ row }) => {
          const n = row.original.batch_count;
          if (!n) return <span className="text-muted-foreground">0</span>;
          return (
            <button
              className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/ap-batches?f_runLogId=${row.original.id}`);
              }}
            >
              {n}
            </button>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setLogsRunId(row.original.id);
            }}
          >
            <Eye className="mr-2 h-4 w-4" />
            View
          </Button>
        ),
      },
    ],
    [navigate],
  );

  const toolbarExtra = (
    <div className="flex items-center gap-1">
      <Input
        type="date"
        value={dateFrom}
        onChange={(e) => setFilter('startedAt.gte', e.target.value)}
        className="h-9 w-[150px]"
        aria-label="Started from"
      />
      <span className="text-xs text-muted-foreground">to</span>
      <Input
        type="date"
        value={dateTo}
        onChange={(e) => setFilter('startedAt.lte', e.target.value ? `${e.target.value} 23:59:59` : '')}
        className="h-9 w-[150px]"
        aria-label="Started to"
      />
      {(dateFrom || dateTo) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2 text-xs text-muted-foreground"
          onClick={() =>
            // One combined call, not two sequential setFilter() calls -- each
            // would otherwise read the same pre-update columnFilters snapshot
            // (React batches the state updates from useSearchParams within one
            // handler), so the second call would silently undo the first.
            grid.setColumnFilters(
              grid.state.columnFilters.filter(
                (f) => f.id !== 'startedAt.gte' && f.id !== 'startedAt.lte',
              ),
            )
          }
        >
          Clear
        </Button>
      )}
    </div>
  );

  return (
    <>
      <Breadcrumbs items={[{ label: 'Run Logs' }]} />
      <PageHeader
        title="Run Logs"
        description="One row per process_invoices.py run — every batch it pulled, and its full step-by-step log."
      />
      <DataGrid
        columns={columns}
        data={query.data?.data}
        pagination={query.data?.pagination}
        grid={grid}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        error={query.error}
        onRefresh={() => query.refetch()}
        onRowClick={(row) => setLogsRunId(row.id)}
        getRowId={(row) => String(row.id)}
        searchPlaceholder="Search runs…"
        exportFilename="run-logs"
        toolbarExtra={toolbarExtra}
      />

      <RunLogProcessLogsSheet runLogId={logsRunId} onOpenChange={(open) => !open && setLogsRunId(null)} />
    </>
  );
}
