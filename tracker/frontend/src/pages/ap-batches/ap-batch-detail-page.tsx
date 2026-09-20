import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, RotateCw } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
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
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useListQuery, useResourceQuery } from '@/lib/use-list';
import { RunLogProcessLogsSheet } from '@/pages/run-logs/run-log-process-logs-sheet';

interface BatchDetail {
  id: number;
  ap_batch_name: string;
  ap_batch_payment_file_id: number;
  interface_id: number;
  interface_name: string | null;
  ap_batch_status: string;
  processed_date: string | null;
  invoice_process_uuid: string | null;
  statusRollup: { status: string | null; count: number }[];
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
  const [reprocessRunLogId, setReprocessRunLogId] = React.useState<number | null>(null);

  // Re-runs `process_invoices.py --interface-id <id> --ap-batch-name <name>`
  // for this exact batch (see backend modules/reprocess) -- re-pulls the
  // batch + its invoices, regenerates the CSV, re-uploads to SFTP, and
  // re-sends the run summary email, same as any other run.
  const reprocess = useMutation({
    mutationFn: () => api.post<{ data: { runLogId: number } }>(`/ap-batches/${id}/reprocess`),
    onSuccess: (res) => {
      toast.success(`Reprocessing started — run #${res.data.runLogId}`);
      setReprocessRunLogId(res.data.runLogId);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Failed to start reprocessing'),
  });

  const invoicesGrid = useDataGrid({ prefix: 'inv', defaultSort: { id: 'apInvoiceId', desc: false } });
  const invoices = useListQuery<BatchInvoice>(
    `ap-batch-${id}-invoices`,
    `/ap-batches/${id}/invoices`,
    invoicesGrid.apiParams,
  );

  const processUuid = batch.data?.invoice_process_uuid;
  const rlGrid = useDataGrid({ prefix: 'rl', defaultSort: { id: 'createdDatetime', desc: true } });
  const responseLogs = useListQuery<Record<string, unknown>>(
    `ap-batch-${id}-rl`,
    '/response-logs',
    processUuid ? { ...rlGrid.apiParams, 'filter.invoiceProcessUuid': processUuid } : rlGrid.apiParams,
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
        description="Batch drill-down: invoices and API response logs."
        actions={
          <>
            {batch.data && batch.data.ap_batch_status !== 'New' && (
              <Button
                variant="outline"
                size="sm"
                disabled={reprocess.isPending}
                onClick={() => reprocess.mutate()}
              >
                <RotateCw className={cn('mr-2 h-4 w-4', reprocess.isPending && 'animate-spin')} />
                {reprocess.isPending ? 'Reprocessing…' : 'Reprocess'}
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to="/ap-batches">
                <ArrowLeft className="mr-2 h-4 w-4" />
                All batches
              </Link>
            </Button>
          </>
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
                  {
                    label: 'Process UUID',
                    value: (
                      <span className="font-mono text-xs">
                        {batch.data.invoice_process_uuid ?? '—'}
                      </span>
                    ),
                  },
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
            onRowClick={(row) => navigate(`/response-logs/${row.log_id}`)}
            getRowId={(row) => String(row.log_id)}
            exportFilename={`batch-${id}-response-logs`}
            emptyMessage={processUuid ? 'No response logs' : 'Not processed yet — nothing logged'}
          />
        </TabsContent>
      </Tabs>

      <RunLogProcessLogsSheet
        runLogId={reprocessRunLogId}
        onOpenChange={(open) => !open && setReprocessRunLogId(null)}
      />
    </>
  );
}
