import type { ColumnDef } from '@tanstack/react-table';
import { ChevronRight } from 'lucide-react';
import * as React from 'react';
import { DataGrid, useDataGrid } from '@/components/data-grid';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useListQuery } from '@/lib/use-list';

type Row = Record<string, unknown>;

const lineColumns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'line_detail_id', header: 'line_detail_id', enableHiding: false },
  { accessorKey: 'detail_id', header: 'detail_id' },
  { accessorKey: 'service_total_count', header: 'service_total_count' },
  {
    accessorKey: 'created_datetime',
    header: 'created_datetime',
    cell: ({ getValue }) => formatDateTime(getValue() as string),
  },
];

const serviceColumns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'service_pk', header: 'service_pk', enableHiding: false },
  { accessorKey: 'service_index', header: 'index' },
  { accessorKey: 'service_id', header: 'service_id' },
  { accessorKey: 'btn', header: 'btn' },
  { accessorKey: 'sub_account_number', header: 'sub_account_number' },
  { accessorKey: 'sakon_service_id', header: 'sakon_service_id' },
  { accessorKey: 'api_invoice_detail_id', header: 'api_invoice_detail_id' },
];

const money = (v: unknown) => (v == null || v === '' ? '—' : formatNumber(v as number, 2));

const chargeColumns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'charge_pk', header: 'charge_pk', enableHiding: false },
  { accessorKey: 'component', header: 'component' },
  { accessorKey: 'component1_type', header: 'component1_type' },
  { accessorKey: 'description', header: 'description' },
  {
    accessorKey: 'current_month_charges',
    header: 'current_month_charges',
    cell: ({ getValue }) => money(getValue()),
  },
  {
    accessorKey: 'previous_month_charges',
    header: 'previous_month_charges',
    cell: ({ getValue }) => money(getValue()),
  },
  {
    accessorKey: 'inventory_charge',
    header: 'inventory_charge',
    cell: ({ getValue }) => money(getValue()),
  },
  { accessorKey: 'expected_rate', header: 'expected_rate' },
  { accessorKey: 'usage_unit1_label', header: 'usage_unit1_label' },
  { accessorKey: 'usage_unit1_value', header: 'usage_unit1_value' },
];

/**
 * Lines → Services → Charges, each a full server-side grid (sort / paginate /
 * filter), scoped by the parent id and navigated with a breadcrumb. Backed by
 * /api/tables/* so the ordering and paging happen in SQL.
 */
export function InvoiceLineDrill({ detailId }: { detailId: number }) {
  const [line, setLine] = React.useState<{ id: number } | null>(null);
  const [service, setService] = React.useState<{ id: number } | null>(null);

  const linesGrid = useDataGrid({ prefix: 'ln', defaultSort: { id: 'line_detail_id', desc: false } });
  const lines = useListQuery<Row>(
    `inv-lines-${detailId}`,
    '/tables/invoice_line_detail',
    { ...linesGrid.apiParams, 'filter.detail_id': detailId },
  );

  const servicesGrid = useDataGrid({ prefix: 'sv', defaultSort: { id: 'service_index', desc: false } });
  const services = useListQuery<Row>(
    `inv-services-${line?.id}`,
    '/tables/invoice_service',
    { ...servicesGrid.apiParams, 'filter.line_detail_id': line?.id ?? 0 },
  );

  const chargesGrid = useDataGrid({ prefix: 'ch', defaultSort: { id: 'charge_pk', desc: false } });
  const charges = useListQuery<Row>(
    `inv-charges-${service?.id}`,
    '/tables/invoice_charge',
    { ...chargesGrid.apiParams, 'filter.service_pk': service?.id ?? 0 },
  );

  const level = service ? 'charges' : line ? 'services' : 'lines';

  return (
    <div className="space-y-3">
      <nav className="flex flex-wrap items-center gap-1 text-sm">
        <button
          className={level === 'lines' ? 'font-medium' : 'text-muted-foreground hover:underline'}
          onClick={() => {
            setLine(null);
            setService(null);
          }}
        >
          Lines
        </button>
        {line && (
          <>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <button
              className={level === 'services' ? 'font-medium' : 'text-muted-foreground hover:underline'}
              onClick={() => setService(null)}
            >
              Line #{line.id}
            </button>
          </>
        )}
        {service && (
          <>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Service #{service.id} · Charges</span>
          </>
        )}
      </nav>

      {level === 'lines' && (
        <DataGrid
          columns={lineColumns}
          data={lines.data?.data}
          pagination={lines.data?.pagination}
          grid={linesGrid}
          isLoading={lines.isLoading}
          isFetching={lines.isFetching}
          error={lines.error}
          onRefresh={() => lines.refetch()}
          onRowClick={(row) => setLine({ id: Number(row.line_detail_id) })}
          getRowId={(row) => String(row.line_detail_id)}
          exportFilename="invoice-lines"
          emptyMessage="No line details stored"
        />
      )}

      {level === 'services' && (
        <>
          <Button variant="outline" size="sm" onClick={() => setLine(null)}>
            ← Back to lines
          </Button>
          <DataGrid
            columns={serviceColumns}
            data={services.data?.data}
            pagination={services.data?.pagination}
            grid={servicesGrid}
            isLoading={services.isLoading}
            isFetching={services.isFetching}
            error={services.error}
            onRefresh={() => services.refetch()}
            onRowClick={(row) => setService({ id: Number(row.service_pk) })}
            getRowId={(row) => String(row.service_pk)}
            exportFilename={`line-${line?.id}-services`}
            emptyMessage="No services for this line"
          />
        </>
      )}

      {level === 'charges' && (
        <>
          <Button variant="outline" size="sm" onClick={() => setService(null)}>
            ← Back to services
          </Button>
          <DataGrid
            columns={chargeColumns}
            data={charges.data?.data}
            pagination={charges.data?.pagination}
            grid={chargesGrid}
            isLoading={charges.isLoading}
            isFetching={charges.isFetching}
            error={charges.error}
            onRefresh={() => charges.refetch()}
            getRowId={(row) => String(row.charge_pk)}
            exportFilename={`service-${service?.id}-charges`}
            emptyMessage="No charges for this service"
          />
        </>
      )}
    </div>
  );
}
