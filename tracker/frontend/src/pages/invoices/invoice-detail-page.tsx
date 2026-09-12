import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { FieldList, recordToFields } from '@/components/field-list';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { useResourceQuery } from '@/lib/use-list';
import { InvoiceLineDrill } from './invoice-line-drill';

interface InvoiceDetailResp {
  invoiceId: number;
  invoiceNumber: string;
  summary: Record<string, unknown> | null;
  detail: (Record<string, unknown> & { detail_id?: number }) | null;
  counts: { line_count: number; service_count: number; charge_count: number } | null;
  batch: {
    id: number;
    ap_batch_name: string;
    ap_batch_status: string;
    interface_name: string | null;
  } | null;
  responseLogs: Record<string, unknown>[];
}

export function InvoiceDetailPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const query = useResourceQuery<InvoiceDetailResp>(`invoice-${invoiceId}`, `/invoices/${invoiceId}`);
  const inv = query.data;
  const detailId = inv?.detail?.detail_id;

  const b = inv?.batch;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Interfaces', to: '/interfaces' },
          { label: 'AP Batches', to: '/ap-batches' },
          ...(b ? [{ label: b.ap_batch_name, to: `/ap-batches/${b.id}` }] : []),
          { label: inv ? `Invoice ${inv.invoiceNumber}` : `Invoice ${invoiceId}` },
        ]}
      />
      <PageHeader
        title={inv ? `Invoice ${inv.invoiceNumber}` : `Invoice ${invoiceId}`}
        description="Stored invoice data: summary, detail and the line → service → charge grids."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/invoices">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Explorer
            </Link>
          </Button>
        }
      />

      {query.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : query.error ? (
        <p className="text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : 'Failed to load'}
        </p>
      ) : inv ? (
        <>
          <Card>
            <CardContent className="pt-6">
              <FieldList
                columns={3}
                fields={[
                  { label: 'Invoice ID', value: inv.invoiceId },
                  { label: 'Invoice #', value: inv.invoiceNumber },
                  {
                    label: 'Batch',
                    value: inv.batch ? (
                      <Link className="underline" to={`/ap-batches/${inv.batch.id}`}>
                        {inv.batch.ap_batch_name}
                      </Link>
                    ) : (
                      '—'
                    ),
                  },
                  { label: 'Interface', value: inv.batch?.interface_name ?? '—' },
                  { label: 'Lines', value: inv.counts?.line_count ?? 0 },
                  { label: 'Services', value: inv.counts?.service_count ?? 0 },
                  { label: 'Charges', value: inv.counts?.charge_count ?? 0 },
                ]}
              />
            </CardContent>
          </Card>

          <Tabs defaultValue="lines" className="mt-2">
            <TabsList>
              <TabsTrigger value="lines">Lines / Services / Charges</TabsTrigger>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="detail">Detail</TabsTrigger>
              <TabsTrigger value="logs">Response Logs ({inv.responseLogs.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="lines" className="mt-4">
              {detailId ? (
                <InvoiceLineDrill detailId={detailId} />
              ) : (
                <p className="text-sm text-muted-foreground">No invoice_detail row — nothing to drill.</p>
              )}
            </TabsContent>

            <TabsContent value="summary" className="mt-4">
              {inv.summary ? (
                <FieldList columns={3} fields={recordToFields(inv.summary)} />
              ) : (
                <p className="text-sm text-muted-foreground">No summary row.</p>
              )}
            </TabsContent>

            <TabsContent value="detail" className="mt-4">
              {inv.detail ? (
                <FieldList columns={3} fields={recordToFields(inv.detail)} />
              ) : (
                <p className="text-sm text-muted-foreground">No detail row.</p>
              )}
            </TabsContent>

            <TabsContent value="logs" className="mt-4 space-y-3">
              {inv.responseLogs.length === 0 && (
                <p className="text-sm text-muted-foreground">No response logs.</p>
              )}
              {inv.responseLogs.map((log) => (
                <Card key={String(log.log_id)}>
                  <CardContent className="pt-6">
                    <FieldList
                      columns={3}
                      fields={[
                        { label: 'Log ID', value: String(log.log_id) },
                        { label: 'HTTP', value: String(log.http_status_code ?? '—') },
                        { label: 'Success', value: log.is_success ? 'Yes' : 'No' },
                        { label: 'When', value: formatDateTime(log.created_datetime as string) },
                        {
                          label: 'URL',
                          value: <span className="break-all">{String(log.request_url)}</span>,
                        },
                      ]}
                    />
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </>
  );
}
