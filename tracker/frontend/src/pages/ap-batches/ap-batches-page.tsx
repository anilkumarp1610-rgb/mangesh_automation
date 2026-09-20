import type { ColumnDef } from '@tanstack/react-table';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ActiveFilters } from '@/components/active-filters';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { DataGrid, useDataGrid } from '@/components/data-grid';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useListQuery } from '@/lib/use-list';

interface BatchRow {
  id: number;
  ap_batch_name: string;
  ap_batch_payment_file_id: number;
  interface_id: number;
  interface_name: string | null;
  run_log_id: number | null;
  ap_batch_status: string;
  client: string | null;
  currency: string | null;
  no_of_invoices: number | null;
  no_of_vendors: number | null;
  invoice_amount: number | null;
  ap_created_date: string | null;
  processed_date: string | null;
  invoice_count: number;
  invoice_failed_count: number;
}

const STATUSES = ['New', 'Success', 'Failure'] as const;

export function ApBatchesPage() {
  const grid = useDataGrid({ defaultSort: { id: 'id', desc: true } });
  const query = useListQuery<BatchRow>('ap-batches', '/ap-batches', grid.apiParams);
  const navigate = useNavigate();

  const status = grid.state.columnFilters.find((f) => f.id === 'status')?.value as
    | string
    | undefined;
  const dateFrom =
    (grid.state.columnFilters.find((f) => f.id === 'apCreatedDate.gte')?.value as string) ?? '';
  // ap_created_date is a DATETIME with a real time-of-day component, so the
  // "to" bound is stored with 23:59:59 appended (set below) to stay inclusive
  // of that whole day -- stripped back to YYYY-MM-DD here just for display.
  const dateTo = (
    (grid.state.columnFilters.find((f) => f.id === 'apCreatedDate.lte')?.value as string) ?? ''
  ).slice(0, 10);
  const client = (grid.state.columnFilters.find((f) => f.id === 'client')?.value as string) ?? '';

  const setFilter = (id: string, value: string) => {
    const rest = grid.state.columnFilters.filter((f) => f.id !== id);
    grid.setColumnFilters(value ? [...rest, { id, value }] : rest);
  };

  const columns = React.useMemo<ColumnDef<BatchRow, unknown>[]>(
    () => [
      { accessorKey: 'id', header: 'ID', enableHiding: false },
      { accessorKey: 'ap_batch_name', header: 'Batch Name', enableHiding: false },
      { accessorKey: 'interface_name', header: 'Interface' },
      { accessorKey: 'client', header: 'Client' },
      { accessorKey: 'currency', header: 'Currency' },
      {
        accessorKey: 'ap_batch_status',
        header: 'Status',
        cell: ({ getValue }) => <StatusBadge value={getValue() as string} />,
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
                navigate(`/ap-batches/${row.original.id}?tab=invoices`);
              }}
            >
              {n}
            </button>
          );
        },
      },
      {
        accessorKey: 'invoice_failed_count',
        header: 'Failed',
        cell: ({ getValue }) => {
          const n = getValue() as number;
          return n > 0 ? <span className="font-medium text-destructive">{n}</span> : n;
        },
      },
      {
        accessorKey: 'invoice_amount',
        header: 'Amount',
        cell: ({ row }) =>
          formatCurrency(row.original.invoice_amount, row.original.currency ? `${row.original.currency} ` : ''),
      },
      {
        accessorKey: 'ap_created_date',
        header: 'AP Created',
        cell: ({ getValue }) => formatDate(getValue() as string),
      },
      {
        accessorKey: 'processed_date',
        header: 'Processed',
        cell: ({ getValue }) => formatDateTime(getValue() as string),
      },
    ],
    [navigate],
  );

  const statusSwitch = (
    <div className="flex rounded-md border p-0.5">
      <Button
        variant={!status ? 'secondary' : 'ghost'}
        size="sm"
        className="h-7 px-2.5 text-xs"
        onClick={() => setFilter('status', '')}
      >
        All
      </Button>
      {STATUSES.map((s) => (
        <Button
          key={s}
          variant={status === s ? 'secondary' : 'ghost'}
          size="sm"
          className={cn('h-7 px-2.5 text-xs', status === s && s === 'Failure' && 'text-destructive')}
          onClick={() => setFilter('status', s)}
        >
          {s === 'Failure' ? 'Failed' : s}
        </Button>
      ))}
    </div>
  );

  const toolbarExtra = (
    <>
      {statusSwitch}
      <Input
        value={client}
        onChange={(e) => setFilter('client', e.target.value)}
        placeholder="Client…"
        className="h-9 w-[160px]"
      />
      <div className="flex items-center gap-1">
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setFilter('apCreatedDate.gte', e.target.value)}
          className="h-9 w-[150px]"
          aria-label="AP created from"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="date"
          value={dateTo}
          onChange={(e) =>
            setFilter('apCreatedDate.lte', e.target.value ? `${e.target.value} 23:59:59` : '')
          }
          className="h-9 w-[150px]"
          aria-label="AP created to"
        />
      </div>
    </>
  );

  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Interfaces', to: '/interfaces' }, { label: 'AP Batches' }]}
      />
      <PageHeader title="AP Batches" description="Payment-file batches and their processing status." />
      <ActiveFilters
        specs={[
          {
            param: 'f_interfaceId',
            pageParam: 'page',
            label: (v) => <>Interface #{v}</>,
          },
          {
            param: 'f_runLogId',
            pageParam: 'page',
            label: (v) => <>Run #{v}</>,
          },
        ]}
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
        onRowClick={(row) => navigate(`/ap-batches/${row.id}`)}
        getRowId={(row) => String(row.id)}
        searchPlaceholder="Search batches…"
        exportFilename="ap-batches"
        toolbarExtra={toolbarExtra}
      />
    </>
  );
}
