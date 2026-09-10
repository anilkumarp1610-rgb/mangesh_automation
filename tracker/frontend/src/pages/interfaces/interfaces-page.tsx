import type { ColumnDef } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { DataGrid, useDataGrid } from '@/components/data-grid';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useListQuery } from '@/lib/use-list';
import { InterfaceDetailSheet } from './interface-detail-sheet';
import { InterfaceFormSheet } from './interface-form-sheet';

interface InterfaceRow {
  InterfaceId: number;
  InterfaceName: string;
  IsActive: number;
  SFTP_Host: string | null;
  SMTP_Host: string | null;
  Platform_InstanceUrl: string | null;
  Platform_DB_Name: string | null;
  output_type: string | null;
  Email_Enabled: number;
  Failure_Notification_Enabled: number;
  CreatedDate: string | null;
  ModifiedDate: string | null;
  batchCount: number;
}

export function InterfacesPage() {
  const grid = useDataGrid({ defaultSort: { id: 'interfaceName', desc: false } });
  const query = useListQuery<InterfaceRow>('interfaces', '/interfaces', grid.apiParams);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [viewId, setViewId] = React.useState<number | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<number | null>(null);

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.patch(`/interfaces/${id}/active`, { isActive }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['interfaces'] });
      toast.success('Active status updated');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Update failed'),
  });

  const openCreate = () => {
    setEditId(null);
    setFormOpen(true);
  };
  const openEdit = (id: number) => {
    setEditId(id);
    setFormOpen(true);
  };

  const columns = React.useMemo<ColumnDef<InterfaceRow, unknown>[]>(
    () => [
      { accessorKey: 'InterfaceId', header: 'ID', enableHiding: false },
      { accessorKey: 'InterfaceName', header: 'Name', enableHiding: false },
      { accessorKey: 'SFTP_Host', header: 'SFTP Host' },
      { accessorKey: 'SMTP_Host', header: 'SMTP Host' },
      { accessorKey: 'Platform_DB_Name', header: 'Platform DB' },
      { accessorKey: 'output_type', header: 'Output' },
      {
        accessorKey: 'batchCount',
        header: 'Batches',
        cell: ({ row }) => {
          const n = row.original.batchCount;
          if (!n) return <span className="text-muted-foreground">0</span>;
          return (
            <button
              className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/ap-batches?f_interfaceId=${row.original.InterfaceId}`);
              }}
            >
              {n}
            </button>
          );
        },
      },
      {
        accessorKey: 'IsActive',
        header: 'Active',
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={Boolean(row.original.IsActive)}
              disabled={toggleActive.isPending}
              onCheckedChange={(checked) =>
                toggleActive.mutate({ id: row.original.InterfaceId, isActive: checked })
              }
            />
          </div>
        ),
      },
      {
        accessorKey: 'CreatedDate',
        header: 'Created',
        cell: ({ getValue }) => formatDateTime(getValue() as string),
      },
      {
        id: 'actions',
        header: '',
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              openEdit(row.original.InterfaceId);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        ),
      },
    ],
    [toggleActive, navigate],
  );

  return (
    <>
      <PageHeader
        title="Interfaces"
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Interface
          </Button>
        }
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
        onRowClick={(row) => setViewId(row.InterfaceId)}
        getRowId={(row) => String(row.InterfaceId)}
        searchPlaceholder="Search interfaces…"
        exportFilename="interfaces"
      />
      <InterfaceDetailSheet
        interfaceId={viewId}
        onOpenChange={(open) => !open && setViewId(null)}
        onEdit={(id) => {
          setViewId(null);
          openEdit(id);
        }}
      />
      <InterfaceFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        interfaceId={editId}
      />
    </>
  );
}
