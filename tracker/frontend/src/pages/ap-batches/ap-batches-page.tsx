import type { ColumnDef } from '@tanstack/react-table';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ActiveFilters } from '@/components/active-filters';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { DataGrid, useDataGrid } from '@/components/data-grid';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { formatDateTime } from '@/lib/format';
import { useListQuery } from '@/lib/use-list';

interface BatchRow {
  id: number;
  ap_batch_name: string;
  ap_batch_payment_file_id: number;
  interface_id: number;
  interface_name: string | null;
  ap_batch_status: string;
  processed_date: string | null;
  invoice_count: number;
  invoice_failed_count: number;
}

export function ApBatchesPage() {
  const grid = useDataGrid({ defaultSort: { id: 'id', desc: true } });
  const query = useListQuery<BatchRow>('ap-batches', '/ap-batches', grid.apiParams);
  const navigate = useNavigate();

  const columns = React.useMemo<ColumnDef<BatchRow, unknown>[]>(
    () => [
      { accessorKey: 'id', header: 'ID', enableHiding: false },
      { accessorKey: 'ap_batch_name', header: 'Batch Name', enableHiding: false },
      { accessorKey: 'interface_name', header: 'Interface' },
      { accessorKey: 'ap_batch_payment_file_id', header: 'Payment File' },
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
        accessorKey: 'processed_date',
        header: 'Processed',
        cell: ({ getValue }) => formatDateTime(getValue() as string),
      },
    ],
    [navigate],
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
      />
    </>
  );
}
