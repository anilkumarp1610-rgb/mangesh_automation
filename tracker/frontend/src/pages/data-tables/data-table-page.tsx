import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeft } from 'lucide-react';
import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { DataGrid, useDataGrid } from '@/components/data-grid';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useListQuery, useResourceQuery } from '@/lib/use-list';

interface TableMeta {
  key: string;
  label: string;
  columns: string[];
  pk: string;
}

type Row = Record<string, unknown>;

export function DataTablePage() {
  const { table } = useParams<{ table: string }>();
  const meta = useResourceQuery<TableMeta[]>('tables-meta', '/tables');
  const def = meta.data?.find((t) => t.key === table);

  const grid = useDataGrid({ defaultSort: def ? { id: def.pk, desc: true } : undefined });
  const query = useListQuery<Row>(`table-${table}`, `/tables/${table}`, grid.apiParams);

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(() => {
    const sortable = new Set(def?.columns ?? []);
    const keys =
      query.data?.data?.[0] != null
        ? Object.keys(query.data.data[0])
        : (def?.columns ?? []);
    return keys.map((key) => ({
      accessorKey: key,
      header: key,
      enableSorting: sortable.has(key),
      enableColumnFilter: sortable.has(key),
      cell: ({ getValue }) => {
        const v = getValue();
        if (v === null || v === undefined || v === '') return '—';
        return String(v);
      },
    }));
  }, [def, query.data]);

  return (
    <>
      <PageHeader
        title={def?.label ?? table ?? 'Table'}
        description={def ? `${def.key} · primary key ${def.pk}` : 'Raw table rows'}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/tables">
              <ArrowLeft className="mr-2 h-4 w-4" />
              All tables
            </Link>
          </Button>
        }
      />
      <DataGrid
        columns={columns}
        data={query.data?.data}
        pagination={query.data?.pagination}
        grid={grid}
        isLoading={query.isLoading || meta.isLoading}
        isFetching={query.isFetching}
        error={query.error}
        onRefresh={() => query.refetch()}
        getRowId={(row) => String(def ? row[def.pk] : JSON.stringify(row))}
        searchPlaceholder="Search…"
        exportFilename={table ?? 'table'}
      />
    </>
  );
}
