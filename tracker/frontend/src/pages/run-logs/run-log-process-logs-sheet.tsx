import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { DataGrid, useDataGrid } from '@/components/data-grid';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { FieldList } from '@/components/field-list';
import { StatusBadge } from '@/components/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { useListQuery, useResourceQuery } from '@/lib/use-list';
import { cn } from '@/lib/utils';

interface RunLogDetail {
  id: number;
  interface_id: number;
  interface_name: string | null;
  from_date: string | null;
  to_date: string | null;
  ap_batch_name: string | null;
  started_at: string;
  batch_count: number;
  statusRollup: { status: string | null; count: number }[];
}

interface ProcessLogRow {
  id: number;
  ap_payment_file_detail_id: number | null;
  log_level: string;
  logger_name: string | null;
  message: string;
  created_datetime: string;
}

const LEVEL_STYLE: Record<string, string> = {
  DEBUG: 'border-transparent bg-muted text-muted-foreground',
  INFO: 'border-transparent bg-blue-500/15 text-blue-600 dark:text-blue-400',
  WARNING: 'border-transparent bg-warning/15 text-warning',
  ERROR: 'border-transparent bg-destructive/15 text-destructive',
  CRITICAL: 'border-transparent bg-destructive/25 text-destructive',
};

function LevelBadge({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={cn('font-mono text-[11px] font-medium', LEVEL_STYLE[value])}>
      {value}
    </Badge>
  );
}

const columns: ColumnDef<ProcessLogRow, unknown>[] = [
  {
    accessorKey: 'created_datetime',
    header: 'When',
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatDateTime(getValue() as string)}
      </span>
    ),
  },
  {
    accessorKey: 'log_level',
    header: 'Level',
    cell: ({ getValue }) => <LevelBadge value={getValue() as string} />,
  },
  { accessorKey: 'logger_name', header: 'Logger' },
  {
    accessorKey: 'ap_payment_file_detail_id',
    header: 'Batch',
    cell: ({ getValue }) => getValue() ?? <span className="text-muted-foreground">—</span>,
  },
  {
    accessorKey: 'message',
    header: 'Message',
    cell: ({ getValue }) => (
      <span className="block max-w-[520px] whitespace-normal break-words font-mono text-xs">
        {getValue() as string}
      </span>
    ),
  },
];

export function RunLogProcessLogsSheet({
  runLogId,
  onOpenChange,
}: {
  runLogId: number | null;
  onOpenChange: (open: boolean) => void;
}) {
  const run = useResourceQuery<RunLogDetail>(`run-log-${runLogId}`, `/run-logs/${runLogId}`, runLogId !== null);

  const grid = useDataGrid({ prefix: 'log', defaultSort: { id: 'id', desc: false } });
  // Polls while the sheet is open so an in-progress run's log fills in live,
  // without needing a WebSocket/SSE channel -- ap_process_log is written to
  // in near-real-time by the pipeline's DbLogHandler as it runs.
  const logs = useListQuery<ProcessLogRow>(
    `run-log-${runLogId}-logs`,
    `/run-logs/${runLogId}/process-logs`,
    runLogId !== null ? grid.apiParams : {},
    { refetchInterval: runLogId !== null ? 3000 : false },
  );

  const windowLabel = run.data
    ? run.data.ap_batch_name
      ? run.data.ap_batch_name
      : run.data.from_date && run.data.to_date
        ? `${run.data.from_date} → ${run.data.to_date}`
        : 'Default lookback window'
    : '';

  return (
    <Sheet open={runLogId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{run.data ? `Run #${run.data.id}` : 'Run Log'}</SheetTitle>
          <SheetDescription>
            {run.data ? `${run.data.interface_name ?? run.data.interface_id} · ${windowLabel}` : 'Loading…'}
          </SheetDescription>
        </SheetHeader>

        {run.isLoading ? (
          <Skeleton className="mt-6 h-20 w-full" />
        ) : run.data ? (
          <div className="mt-4 space-y-3">
            <FieldList
              columns={3}
              fields={[
                { label: 'Started', value: formatDateTime(run.data.started_at) },
                { label: 'AP Batches Pulled', value: run.data.batch_count },
                {
                  label: 'Batch Statuses',
                  value: run.data.statusRollup.length ? (
                    <div className="flex flex-wrap gap-1">
                      {run.data.statusRollup.map((s) => (
                        <span key={s.status ?? 'null'} className="inline-flex items-center gap-1">
                          <StatusBadge value={s.status} /> ×{s.count}
                        </span>
                      ))}
                    </div>
                  ) : (
                    '—'
                  ),
                },
              ]}
            />
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Process Log {logs.data ? `(${logs.data.pagination.total})` : ''}
          </h3>
          <Select
            value={String(grid.state.columnFilters.find((f) => f.id === 'logLevel')?.value ?? 'all')}
            onValueChange={(v) =>
              grid.setColumnFilters(v === 'all' ? [] : [{ id: 'logLevel', value: v }])
            }
          >
            <SelectTrigger className="h-8 w-[140px]">
              <SelectValue placeholder="All levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="DEBUG">Debug</SelectItem>
              <SelectItem value="INFO">Info</SelectItem>
              <SelectItem value="WARNING">Warning</SelectItem>
              <SelectItem value="ERROR">Error</SelectItem>
              <SelectItem value="CRITICAL">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="mt-3">
          <DataGrid
            columns={columns}
            data={logs.data?.data}
            pagination={logs.data?.pagination}
            grid={grid}
            isLoading={logs.isLoading}
            isFetching={logs.isFetching}
            error={logs.error}
            onRefresh={() => logs.refetch()}
            getRowId={(row) => String(row.id)}
            searchPlaceholder="Search messages…"
            exportFilename={`run-${runLogId}-process-log`}
            emptyMessage="No log lines yet"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
