import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { FieldList } from '@/components/field-list';
import { JsonViewer } from '@/components/json-viewer';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { useResourceQuery } from '@/lib/use-list';

interface ResponseLogDetail {
  log_id: number;
  invoice_number: string;
  request_url: string;
  http_status_code: number | null;
  is_success: number | null;
  response_message: string | null;
  response_body: unknown;
  error_message: string | null;
  created_datetime: string;
  invoice_process_uuid: string | null;
}

export function ResponseLogDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useResourceQuery<ResponseLogDetail>(`response-log-${id}`, `/response-logs/${id}`);
  const log = query.data;

  return (
    <>
      <PageHeader
        title={`Response Log ${id}`}
        description="Raw API call record (invoice_response_log)."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/run-logs">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Run Logs
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
      ) : log ? (
        <>
          <Card>
            <CardContent className="pt-6">
              <FieldList
                columns={3}
                fields={[
                  { label: 'Log ID', value: log.log_id },
                  { label: 'Invoice #', value: log.invoice_number },
                  { label: 'HTTP', value: log.http_status_code ?? '—' },
                  { label: 'Success', value: log.is_success ? 'Yes' : 'No' },
                  { label: 'Message', value: log.response_message ?? '—' },
                  { label: 'When', value: formatDateTime(log.created_datetime) },
                  {
                    label: 'Run UUID',
                    value: <span className="font-mono text-xs">{log.invoice_process_uuid ?? '—'}</span>,
                  },
                  {
                    label: 'Request URL',
                    value: <span className="break-all">{log.request_url}</span>,
                  },
                ]}
              />
            </CardContent>
          </Card>

          {log.error_message && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-destructive">Error</h3>
              <pre className="overflow-auto rounded-md border bg-destructive/10 p-4 text-xs text-destructive">
                {log.error_message}
              </pre>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold">Response Body</h3>
            <JsonViewer value={log.response_body} maxHeight={560} />
          </div>
        </>
      ) : null}
    </>
  );
}
