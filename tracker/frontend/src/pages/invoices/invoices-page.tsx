import type { ColumnDef } from '@tanstack/react-table';
import { useNavigate } from 'react-router-dom';
import { DataGrid, useDataGrid } from '@/components/data-grid';
import { PageHeader } from '@/components/page-header';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { useListQuery } from '@/lib/use-list';

interface InvoiceRow {
  summary_id: number;
  invoice_id: number;
  invoice_number: string;
  account_number: string | null;
  organization: string | null;
  vendor_name: string | null;
  invoice_step: string | null;
  account_service_type: string | null;
  total_amount_due: string | null;
  amount_to_pay: string | null;
  currency_symbol: string | null;
  billing_date: string | null;
  due_date: string | null;
  fetched_datetime: string | null;
}

const columns: ColumnDef<InvoiceRow, unknown>[] = [
  { accessorKey: 'invoice_id', header: 'Invoice ID', enableHiding: false },
  { accessorKey: 'invoice_number', header: 'Invoice #', enableHiding: false },
  { accessorKey: 'organization', header: 'Organization' },
  { accessorKey: 'vendor_name', header: 'Vendor' },
  { accessorKey: 'invoice_step', header: 'Step' },
  { accessorKey: 'account_number', header: 'Account' },
  { accessorKey: 'account_service_type', header: 'Service Type' },
  {
    accessorKey: 'total_amount_due',
    header: 'Total Due',
    cell: ({ row }) => formatCurrency(row.original.total_amount_due, row.original.currency_symbol ?? ''),
  },
  {
    accessorKey: 'amount_to_pay',
    header: 'To Pay',
    cell: ({ row }) => formatCurrency(row.original.amount_to_pay, row.original.currency_symbol ?? ''),
  },
  {
    accessorKey: 'billing_date',
    header: 'Billing',
    cell: ({ getValue }) => formatDate(getValue() as string),
  },
  {
    accessorKey: 'due_date',
    header: 'Due',
    cell: ({ getValue }) => formatDate(getValue() as string),
  },
  {
    accessorKey: 'fetched_datetime',
    header: 'Fetched',
    cell: ({ getValue }) => formatDateTime(getValue() as string),
  },
];

export function InvoicesPage() {
  const grid = useDataGrid({ defaultSort: { id: 'fetchedDatetime', desc: true } });
  const query = useListQuery<InvoiceRow>('invoices', '/invoices', grid.apiParams);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="Invoice Explorer"
        description="Invoices retrieved from the platform API and stored across the invoice tables."
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
        onRowClick={(row) => navigate(`/invoices/${row.invoice_id}`)}
        getRowId={(row) => String(row.invoice_id)}
        searchPlaceholder="Search invoice # / account…"
        exportFilename="invoices"
      />
    </>
  );
}
