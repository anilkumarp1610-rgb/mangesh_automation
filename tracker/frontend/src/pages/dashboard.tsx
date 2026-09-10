import { PageHeader } from '@/components/page-header';
import { MonthlyBatchChart } from './dashboard/monthly-batch-chart';

export function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of interfaces, batches and processing activity."
      />
      <MonthlyBatchChart />
    </>
  );
}
