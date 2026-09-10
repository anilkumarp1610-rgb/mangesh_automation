import { ArrowLeft } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { FieldList } from '@/components/field-list';
import { Segmented } from '@/components/segmented';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { useResourceQuery } from '@/lib/use-list';

interface RunDetail {
  id: number;
  proces_datetime: string | null;
  invoice_process_uuid: string | null;
  ap_payment_file_detail_id: number | null;
  ap_batch_name: string | null;
  ap_batch_status: string | null;
  interface_name: string | null;
  responseLogs: Record<string, unknown>[];
  summaries: Record<string, unknown>[];
}

type OutcomeFilter = 'all' | 'success' | 'failure';

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useResourceQuery<RunDetail>(`run-${id}`, `/process-logs/${id}`);
  const run = query.data;

  const [outcome, setOutcome] = React.useState<OutcomeFilter>('all');
  const allCalls = run?.responseLogs ?? [];
  const successCount = allCalls.filter((l) => l.is_success).length;
  const failureCount = allCalls.length - successCount;
  const calls = allCalls.filter((l) =>
    outcome === 'all' ? true : outcome === 'success' ? l.is_success : !l.is_success,
  );

  const batchId = run?.ap_payment_file_detail_id;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Interfaces', to: '/interfaces' },
          { label: 'AP Batches', to: '/ap-batches' },
          ...(batchId
            ? [
                {
                  label: run?.ap_batch_name ?? `Batch #${batchId}`,
                  to: `/ap-batches/${batchId}`,
                },
                { label: 'Runs', to: `/run-logs?p_f_batchId=${batchId}` },
              ]
            : [{ label: 'Runs', to: '/run-logs' }]),
          { label: `Run ${id}` },
        ]}
      />
      <PageHeader
        title={`Run ${id}`}
        description="One pipeline run: its API calls and the invoice summaries it produced."
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
      ) : run ? (
        <>
          <Card>
            <CardContent className="pt-6">
              <FieldList
                columns={3}
                fields={[
                  { label: 'Run ID', value: run.id },
                  {
                    label: 'Batch',
                    value: run.ap_payment_file_detail_id ? (
                      <Link className="underline" to={`/ap-batches/${run.ap_payment_file_detail_id}`}>
                        {run.ap_batch_name ?? run.ap_payment_file_detail_id}
                      </Link>
                    ) : (
                      '—'
                    ),
                  },
                  { label: 'Batch Status', value: <StatusBadge value={run.ap_batch_status} /> },
                  { label: 'Interface', value: run.interface_name ?? '—' },
                  { label: 'When', value: formatDateTime(run.proces_datetime) },
                  {
                    label: 'Process UUID',
                    value: <span className="font-mono text-xs">{run.invoice_process_uuid}</span>,
                  },
                ]}
              />
            </CardContent>
          </Card>

          <Tabs defaultValue="calls" className="mt-2">
            <TabsList>
              <TabsTrigger value="calls">API Calls ({run.responseLogs.length})</TabsTrigger>
              <TabsTrigger value="summaries">Summaries ({run.summaries.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="calls" className="mt-4 space-y-3">
              <Segmented<OutcomeFilter>
                value={outcome}
                onChange={setOutcome}
                options={[
                  { value: 'all', label: 'All', count: allCalls.length },
                  { value: 'success', label: 'Success', count: successCount },
                  { value: 'failure', label: 'Failure', count: failureCount },
                ]}
              />
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-left">
                    <tr>
                      <th className="p-3">Log ID</th>
                      <th className="p-3">Invoice #</th>
                      <th className="p-3">HTTP</th>
                      <th className="p-3">Outcome</th>
                      <th className="p-3">Message</th>
                      <th className="p-3">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calls.map((l) => (
                      <tr key={String(l.log_id)} className="border-t hover:bg-muted/40">
                        <td className="p-3">{String(l.log_id)}</td>
                        <td className="p-3">
                          {l.invoice_id ? (
                            <Link className="text-primary underline-offset-2 hover:underline" to={`/invoices/${l.invoice_id}`}>
                              {String(l.invoice_number)}
                            </Link>
                          ) : (
                            String(l.invoice_number)
                          )}
                        </td>
                        <td className="p-3">{String(l.http_status_code ?? '—')}</td>
                        <td className="p-3">
                          {l.is_success ? (
                            <span style={{ color: 'hsl(var(--chart-success))' }}>Success</span>
                          ) : (
                            <span style={{ color: 'hsl(var(--chart-failure))' }}>Failure</span>
                          )}
                        </td>
                        <td className="p-3">{String(l.response_message ?? '—')}</td>
                        <td className="p-3">
                          <button
                            className="text-xs text-muted-foreground hover:underline"
                            onClick={() => navigate(`/run-logs/response/${l.log_id}`)}
                          >
                            {formatDateTime(l.created_datetime as string)} · log
                          </button>
                        </td>
                      </tr>
                    ))}
                    {calls.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-muted-foreground">
                          {allCalls.length === 0 ? 'No API calls logged' : 'No calls match this filter'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="summaries" className="mt-4">
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-left">
                    <tr>
                      <th className="p-3">Invoice ID</th>
                      <th className="p-3">Invoice #</th>
                      <th className="p-3">Account</th>
                      <th className="p-3">Total Due</th>
                      <th className="p-3">To Pay</th>
                      <th className="p-3">Fetched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.summaries.map((s) => (
                      <tr
                        key={String(s.summary_id)}
                        className="cursor-pointer border-t hover:bg-muted/40"
                        onClick={() => navigate(`/invoices/${s.invoice_id}`)}
                      >
                        <td className="p-3">{String(s.invoice_id)}</td>
                        <td className="p-3">{String(s.invoice_number)}</td>
                        <td className="p-3">{String(s.account_number ?? '—')}</td>
                        <td className="p-3">
                          {String(s.currency_symbol ?? '')}
                          {String(s.total_amount_due ?? '—')}
                        </td>
                        <td className="p-3">
                          {String(s.currency_symbol ?? '')}
                          {String(s.amount_to_pay ?? '—')}
                        </td>
                        <td className="p-3">{formatDateTime(s.fetched_datetime as string)}</td>
                      </tr>
                    ))}
                    {run.summaries.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-muted-foreground">
                          No summaries produced
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </>
  );
}
