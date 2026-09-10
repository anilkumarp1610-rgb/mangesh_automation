import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { DataGrid, useDataGrid } from '@/components/data-grid';
import { FieldList } from '@/components/field-list';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { useListQuery, useResourceQuery } from '@/lib/use-list';

interface Run {
  id: number;
  proces_datetime: string;
  invoice_process_uuid: string;
  response_log_count: number;
  summary_count: number;
}
interface BatchDetail {
  id: number;
  ap_batch_name: string;
  ap_batch_payment_file_id: number;
  interface_id: number;
  interface_name: string | null;
  ap_batch_status: string;
  processed_date: string | null;
  log_id: number | null;
  statusRollup: { status: string | null; count: number }[];
  runs: Run[];
}

interface BatchInvoice {
  ap_invoice_id: number;
  ap_invoice_number: string;
  ap_invoice_api_status: string | null;
  api_response_status_code: string | null;
  created_date: string | null;
}

const invoiceColumns: ColumnDef<BatchInvoice, unknown>[] = [
  { accessorKey: 'ap_invoice_id', header: 'ID', enableHiding: false },
  { accessorKey: 'ap_invoice_number', header: 'Invoice #', enableHiding: false },
  {
    accessorKey: 'ap_invoice_api_status',
    header: 'API Status',
    cell: ({ getValue }) => <StatusBadge value={getValue() as string} />,
  },
  { accessorKey: 'api_response_status_code', header: 'HTTP' },
  {
    accessorKey: 'created_date',
    header: 'Created',
    cell: ({ getValue }) => formatDateTime(getValue() as string),
  },
];

const responseLogColumns: ColumnDef<Record<string, unknown>, unknown>[] = [
  { accessorKey: 'log_id', header: 'Log ID', enableHiding: false },
  { accessorKey: 'invoice_number', header: 'Invoice #' },
  { accessorKey: 'http_status_code', header: 'HTTP' },
  {
    accessorKey: 'is_success',
    header: 'Success',
    cell: ({ getValue }) => (getValue() ? 'Yes' : 'No'),
  },
  { accessorKey: 'response_message', header: 'Message' },
  {
    accessorKey: 'created_datetime',
    header: 'When',
    cell: ({ getValue }) => formatDateTime(getValue() as string),
  },
];

export function ApBatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'invoices';
  const setTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: true });
  };
  const batch = useResourceQuery<BatchDetail>(`ap-batch-${id}`, `/ap-batches/${id}`);

  const invoicesGrid = useDataGrid({ prefix: 'inv', defaultSort: { id: 'apInvoiceId', desc: false } });
  const invoices = useListQuery<BatchInvoice>(
    `ap-batch-${id}-invoices`,
    `/ap-batches/${id}/invoices`,
    invoicesGrid.apiParams,
  );

  const uuids = (batch.data?.runs ?? []).map((r) => r.invoice_process_uuid).filter(Boolean);
  const rlGrid = useDataGrid({ prefix: 'rl', defaultSort: { id: 'createdDatetime', desc: true } });
  const responseLogs = useListQuery<Record<string, unknown>>(
    `ap-batch-${id}-rl`,
    '/response-logs',
    uuids.length ? { ...rlGrid.apiParams, 'filter.invoiceProcessUuid.in': uuids.join(',') } : rlGrid.apiParams,
  );

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Interfaces', to: '/interfaces' },
          {
            label: 'AP Batches',
            to: batch.data?.interface_id
              ? `/ap-batches?f_interfaceId=${batch.data.interface_id}`
              : '/ap-batches',
          },
          { label: batch.data ? batch.data.ap_batch_name : `Batch ${id}` },
        ]}
      />
      <PageHeader
        title={batch.data ? batch.data.ap_batch_name : `Batch ${id}`}
        description="Batch drill-down: invoices, runs and API response logs."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/ap-batches">
              <ArrowLeft className="mr-2 h-4 w-4" />
              All batches
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6">
          {batch.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : batch.data ? (
            <>
              <FieldList
                columns={3}
                fields={[
                  { label: 'Batch ID', value: batch.data.id },
                  { label: 'Interface', value: batch.data.interface_name ?? batch.data.interface_id },
                  { label: 'Payment File ID', value: batch.data.ap_batch_payment_file_id },
                  {
                    label: 'Status',
                    value: <StatusBadge value={batch.data.ap_batch_status} />,
                  },
                  { label: 'Processed', value: formatDateTime(batch.data.processed_date) },
                  { label: 'Log ID', value: batch.data.log_id ?? '—' },
                ]}
              />
              {batch.data.statusRollup.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {batch.data.statusRollup.map((s) => (
                    <Badge key={s.status ?? 'null'} variant="outline">
                      {s.status ?? 'unknown'}: {s.count}
                    </Badge>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-destructive">Batch not found</p>
          )}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="mt-2">
        <TabsList>
          <TabsTrigger value="invoices">
            Invoices {invoices.data ? `(${invoices.data.pagination.total})` : ''}
          </TabsTrigger>
          <TabsTrigger value="runs">Runs ({batch.data?.runs.length ?? 0})</TabsTrigger>
          <TabsTrigger value="logs">
            Response Logs {responseLogs.data ? `(${responseLogs.data.pagination.total})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="mt-4">
          <DataGrid
            columns={invoiceColumns}
            data={invoices.data?.data}
            pagination={invoices.data?.pagination}
            grid={invoicesGrid}
            isLoading={invoices.isLoading}
            isFetching={invoices.isFetching}
            error={invoices.error}
            onRefresh={() => invoices.refetch()}
            onRowClick={(row) => navigate(`/ap-invoices/${row.ap_invoice_id}`)}
            getRowId={(row) => String(row.ap_invoice_id)}
            exportFilename={`batch-${id}-invoices`}
          />
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left">
                <tr>
                  <th className="p-3">Run ID</th>
                  <th className="p-3">Process UUID</th>
                  <th className="p-3">When</th>
                  <th className="p-3">Response Logs</th>
                  <th className="p-3">Summaries</th>
                </tr>
              </thead>
              <tbody>
                {(batch.data?.runs ?? []).map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t hover:bg-muted/40"
                    onClick={() => navigate(`/run-logs/${r.id}`)}
                  >
                    <td className="p-3">{r.id}</td>
                    <td className="p-3 font-mono text-xs">{r.invoice_process_uuid}</td>
                    <td className="p-3">{formatDateTime(r.proces_datetime)}</td>
                    <td className="p-3">{r.response_log_count}</td>
                    <td className="p-3">{r.summary_count}</td>
                  </tr>
                ))}
                {batch.data?.runs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-muted-foreground">
                      No runs yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <DataGrid
            columns={responseLogColumns}
            data={responseLogs.data?.data}
            pagination={responseLogs.data?.pagination}
            grid={rlGrid}
            isLoading={responseLogs.isLoading}
            isFetching={responseLogs.isFetching}
            error={responseLogs.error}
            onRefresh={() => responseLogs.refetch()}
            onRowClick={(row) => navigate(`/run-logs/response/${row.log_id}`)}
            getRowId={(row) => String(row.log_id)}
            exportFilename={`batch-${id}-response-logs`}
            emptyMessage={uuids.length ? 'No response logs' : 'No runs yet — nothing logged'}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
