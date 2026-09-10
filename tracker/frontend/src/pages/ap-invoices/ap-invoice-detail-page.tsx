import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { FieldList, recordToFields } from '@/components/field-list';
import { JsonViewer } from '@/components/json-viewer';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { useResourceQuery } from '@/lib/use-list';

interface ResponseLog {
  log_id: number;
  request_url: string;
  http_status_code: number | null;
  is_success: number | null;
  response_message: string | null;
  error_message: string | null;
  created_datetime: string;
}
interface ApInvoiceDetail {
  ap_invoice_id: number;
  ap_invoice_number: string;
  ap_paymentfile_id: number | null;
  ap_batch_name: string | null;
  ap_batch_status: string | null;
  ap_invoice_api_status: string | null;
  api_response_status_code: string | null;
  api_response_obj: unknown;
  created_date: string | null;
  responseLogs: ResponseLog[];
  summary: Record<string, unknown> | null;
}

export function ApInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useResourceQuery<ApInvoiceDetail>(`ap-invoice-${id}`, `/ap-invoices/${id}`);
  const inv = query.data;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Interfaces', to: '/interfaces' },
          { label: 'AP Batches', to: '/ap-batches' },
          ...(inv?.ap_paymentfile_id
            ? [
                {
                  label: inv.ap_batch_name ?? `Batch #${inv.ap_paymentfile_id}`,
                  to: `/ap-batches/${inv.ap_paymentfile_id}?tab=invoices`,
                },
              ]
            : []),
          { label: inv ? inv.ap_invoice_number : `AP Invoice ${id}` },
        ]}
      />
      <PageHeader
        title={inv ? inv.ap_invoice_number : `AP Invoice ${id}`}
        description="Source invoice record, API status and response history."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/ap-batches">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Batches
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
                  { label: 'AP Invoice ID', value: inv.ap_invoice_id },
                  { label: 'Invoice #', value: inv.ap_invoice_number },
                  {
                    label: 'Batch',
                    value: inv.ap_paymentfile_id ? (
                      <Link className="underline" to={`/ap-batches/${inv.ap_paymentfile_id}`}>
                        {inv.ap_batch_name ?? inv.ap_paymentfile_id}
                      </Link>
                    ) : (
                      '—'
                    ),
                  },
                  { label: 'API Status', value: <StatusBadge value={inv.ap_invoice_api_status} /> },
                  { label: 'HTTP Code', value: inv.api_response_status_code ?? '—' },
                  { label: 'Created', value: formatDateTime(inv.created_date) },
                ]}
              />
            </CardContent>
          </Card>

          <Tabs defaultValue="response" className="mt-2">
            <TabsList>
              <TabsTrigger value="response">API Response</TabsTrigger>
              <TabsTrigger value="logs">Response Logs ({inv.responseLogs.length})</TabsTrigger>
              <TabsTrigger value="summary">Summary</TabsTrigger>
            </TabsList>

            <TabsContent value="response" className="mt-4">
              <JsonViewer value={inv.api_response_obj} maxHeight={520} />
            </TabsContent>

            <TabsContent value="logs" className="mt-4 space-y-4">
              {inv.responseLogs.length === 0 && (
                <p className="text-sm text-muted-foreground">No response logs for this invoice.</p>
              )}
              {inv.responseLogs.map((log) => (
                <Card key={log.log_id}>
                  <CardContent className="space-y-3 pt-6">
                    <FieldList
                      columns={3}
                      fields={[
                        { label: 'Log ID', value: log.log_id },
                        { label: 'HTTP', value: log.http_status_code ?? '—' },
                        { label: 'Success', value: log.is_success ? 'Yes' : 'No' },
                        { label: 'Message', value: log.response_message ?? '—' },
                        { label: 'When', value: formatDateTime(log.created_datetime) },
                        { label: 'URL', value: <span className="break-all">{log.request_url}</span> },
                      ]}
                    />
                    {log.error_message && (
                      <pre className="overflow-auto rounded bg-destructive/10 p-3 text-xs text-destructive">
                        {log.error_message}
                      </pre>
                    )}
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="summary" className="mt-4">
              {inv.summary ? (
                <FieldList columns={3} fields={recordToFields(inv.summary)} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No invoice_summary row found for {inv.ap_invoice_number}.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </>
  );
}
