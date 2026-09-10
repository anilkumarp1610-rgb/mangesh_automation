import type { ColumnDef } from '@tanstack/react-table';
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ActiveFilters } from '@/components/active-filters';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { DataGrid, useDataGrid } from '@/components/data-grid';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime } from '@/lib/format';
import { useListQuery } from '@/lib/use-list';

interface ProcessLogRow {
  id: number;
  proces_datetime: string | null;
  invoice_process_uuid: string | null;
  ap_payment_file_detail_id: number | null;
  ap_batch_name: string | null;
  ap_batch_status: string | null;
  response_log_count: number;
  response_log_failed_count: number;
  invoice_count: number;
  summary_count: number;
}

interface ResponseLogRow {
  log_id: number;
  invoice_number: string;
  http_status_code: number | null;
  is_success: number | null;
  response_message: string | null;
  invoice_process_uuid: string | null;
  created_datetime: string;
}

function makeProcessColumns(
  navigate: ReturnType<typeof useNavigate>,
): ColumnDef<ProcessLogRow, unknown>[] {
  return [
    { accessorKey: 'id', header: 'Run ID', enableHiding: false },
    { accessorKey: 'ap_batch_name', header: 'Batch' },
    {
      accessorKey: 'ap_batch_status',
      header: 'Batch Status',
      cell: ({ getValue }) => <StatusBadge value={getValue() as string} />,
    },
    {
      accessorKey: 'invoice_process_uuid',
      header: 'Process UUID',
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() as string}</span>,
    },
    {
      accessorKey: 'invoice_count',
      header: 'Invoices',
      cell: ({ row }) => {
        const n = row.original.invoice_count;
        if (!n) return <span className="text-muted-foreground">0</span>;
        return (
          <button
            className="font-medium text-primary underline-offset-2 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/run-logs/${row.original.id}`);
            }}
          >
            {n}
          </button>
        );
      },
    },
    { accessorKey: 'response_log_count', header: 'API Calls' },
    {
      accessorKey: 'response_log_failed_count',
      header: 'Failed',
      cell: ({ getValue }) => {
        const n = getValue() as number;
        return n > 0 ? <span className="font-medium text-destructive">{n}</span> : n;
      },
    },
    { accessorKey: 'summary_count', header: 'Summaries' },
    {
      accessorKey: 'proces_datetime',
      header: 'When',
      cell: ({ getValue }) => formatDateTime(getValue() as string),
    },
  ];
}

const responseColumns: ColumnDef<ResponseLogRow, unknown>[] = [
  { accessorKey: 'log_id', header: 'Log ID', enableHiding: false },
  { accessorKey: 'invoice_number', header: 'Invoice #', enableHiding: false },
  { accessorKey: 'http_status_code', header: 'HTTP' },
  {
    accessorKey: 'is_success',
    header: 'Success',
    cell: ({ getValue }) => (getValue() ? 'Yes' : <span className="text-destructive">No</span>),
  },
  { accessorKey: 'response_message', header: 'Message' },
  {
    accessorKey: 'invoice_process_uuid',
    header: 'Run UUID',
    cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() as string}</span>,
  },
  {
    accessorKey: 'created_datetime',
    header: 'When',
    cell: ({ getValue }) => formatDateTime(getValue() as string),
  },
];

export function RunLogsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get('p_f_batchId');
  const processColumns = React.useMemo(() => makeProcessColumns(navigate), [navigate]);

  const procGrid = useDataGrid({ prefix: 'p', defaultSort: { id: 'id', desc: true } });
  const procQuery = useListQuery<ProcessLogRow>('process-logs', '/process-logs', procGrid.apiParams);

  const respGrid = useDataGrid({ prefix: 'r', defaultSort: { id: 'logId', desc: true } });
  const respQuery = useListQuery<ResponseLogRow>('response-logs', '/response-logs', respGrid.apiParams);

  return (
    <>
      <Breadcrumbs
        items={
          batchId
            ? [
                { label: 'Interfaces', to: '/interfaces' },
                { label: 'AP Batches', to: '/ap-batches' },
                { label: `Batch #${batchId}`, to: `/ap-batches/${batchId}` },
                { label: 'Runs' },
              ]
            : [
                { label: 'Interfaces', to: '/interfaces' },
                { label: 'AP Batches', to: '/ap-batches' },
                { label: 'Runs' },
              ]
        }
      />
      <PageHeader
        title="Run Logs"
        description="Pipeline runs (ap_invoices_process_log) and raw API call audit (invoice_response_log)."
      />
      <ActiveFilters
        specs={[{ param: 'p_f_batchId', pageParam: 'p_page', label: (v) => <>Batch #{v}</> }]}
      />
      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">
            Runs {procQuery.data ? `(${procQuery.data.pagination.total})` : ''}
          </TabsTrigger>
          <TabsTrigger value="calls">
            API Calls {respQuery.data ? `(${respQuery.data.pagination.total})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="mt-4">
          <DataGrid
            columns={processColumns}
            data={procQuery.data?.data}
            pagination={procQuery.data?.pagination}
            grid={procGrid}
            isLoading={procQuery.isLoading}
            isFetching={procQuery.isFetching}
            error={procQuery.error}
            onRefresh={() => procQuery.refetch()}
            onRowClick={(row) => navigate(`/run-logs/${row.id}`)}
            getRowId={(row) => String(row.id)}
            searchPlaceholder="Search by batch / UUID…"
            exportFilename="process-logs"
          />
        </TabsContent>

        <TabsContent value="calls" className="mt-4">
          <DataGrid
            columns={responseColumns}
            data={respQuery.data?.data}
            pagination={respQuery.data?.pagination}
            grid={respGrid}
            isLoading={respQuery.isLoading}
            isFetching={respQuery.isFetching}
            error={respQuery.error}
            onRefresh={() => respQuery.refetch()}
            onRowClick={(row) => navigate(`/run-logs/response/${row.log_id}`)}
            getRowId={(row) => String(row.log_id)}
            searchPlaceholder="Search by invoice # / message…"
            exportFilename="response-logs"
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
