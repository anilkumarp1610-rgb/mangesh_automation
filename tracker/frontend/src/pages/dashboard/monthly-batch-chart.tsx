import { useQuery } from '@tanstack/react-query';
import { BarChart3, CheckCircle2, Table2, XCircle } from 'lucide-react';
import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

interface MonthRow {
  month: string;
  monthLabel: string;
  success: number;
  failure: number;
  total: number;
}
interface Resp {
  data: MonthRow[];
  totals: { success: number; failure: number; processed: number; successRate: number };
}

const SUCCESS = 'hsl(var(--chart-success))';
const FAILURE = 'hsl(var(--chart-failure))';

const nonZero = (v: number) => (v > 0 ? v : '');

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; dataKey: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const get = (k: string) => payload.find((p) => p.dataKey === k)?.value ?? 0;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">{label}</p>
      <p className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: SUCCESS }} />
        Success<span className="ml-auto pl-4 font-medium">{get('success')}</span>
      </p>
      <p className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: FAILURE }} />
        Failure<span className="ml-auto pl-4 font-medium">{get('failure')}</span>
      </p>
    </div>
  );
}

export function MonthlyBatchChart() {
  const [months, setMonths] = React.useState(12);
  const [view, setView] = React.useState<'chart' | 'table'>('chart');

  const query = useQuery({
    queryKey: ['dashboard', 'batches-by-month', months],
    queryFn: () => api.get<Resp>('/dashboard/batches-by-month', { months }),
  });

  const rows = query.data?.data ?? [];
  const totals = query.data?.totals;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">AP Batches Processed — by Month</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Processed batches split by outcome.{' '}
            {totals && (
              <span>
                {totals.processed} processed · {totals.successRate}% success
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border p-0.5">
            <Button
              variant={view === 'chart' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              onClick={() => setView('chart')}
              aria-label="Chart view"
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
            <Button
              variant={view === 'table' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              onClick={() => setView('table')}
              aria-label="Table view"
            >
              <Table2 className="h-4 w-4" />
            </Button>
          </div>
          <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
            <SelectTrigger className="h-8 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="6">Last 6 months</SelectItem>
              <SelectItem value="12">Last 12 months</SelectItem>
              <SelectItem value="24">Last 24 months</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        {/* legend — identity is never colour alone */}
        <div className="mb-4 flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" style={{ color: SUCCESS }} />
            Success
          </span>
          <span className="flex items-center gap-1.5">
            <XCircle className="h-4 w-4" style={{ color: FAILURE }} />
            Failure
          </span>
        </div>

        {query.isLoading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : query.error ? (
          <p className="py-16 text-center text-sm text-destructive">
            {query.error instanceof Error ? query.error.message : 'Failed to load'}
          </p>
        ) : totals && totals.processed === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No processed batches in this period.
          </p>
        ) : view === 'chart' ? (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 16, right: 8, left: -16, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis
                  dataKey="monthLabel"
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                  content={<ChartTooltip />}
                />
                <Bar dataKey="success" name="Success" fill={SUCCESS} radius={[3, 3, 0, 0]} maxBarSize={28}>
                  <LabelList
                    dataKey="success"
                    position="top"
                    formatter={nonZero}
                    style={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  />
                </Bar>
                <Bar dataKey="failure" name="Failure" fill={FAILURE} radius={[3, 3, 0, 0]} maxBarSize={28}>
                  <LabelList
                    dataKey="failure"
                    position="top"
                    formatter={nonZero}
                    style={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left">
                <tr>
                  <th className="p-2.5 font-medium">Month</th>
                  <th className="p-2.5 text-right font-medium">Success</th>
                  <th className="p-2.5 text-right font-medium">Failure</th>
                  <th className="p-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.month} className="border-t">
                    <td className="p-2.5">{r.monthLabel}</td>
                    <td className="p-2.5 text-right">{r.success}</td>
                    <td className="p-2.5 text-right">{r.failure}</td>
                    <td className="p-2.5 text-right font-medium">{r.total}</td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="border-t bg-muted/40 font-medium">
                    <td className="p-2.5">Total</td>
                    <td className="p-2.5 text-right">{totals.success}</td>
                    <td className="p-2.5 text-right">{totals.failure}</td>
                    <td className="p-2.5 text-right">{totals.processed}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
