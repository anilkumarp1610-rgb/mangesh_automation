import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { ApBatchDetailPage } from '@/pages/ap-batches/ap-batch-detail-page';
import { ApBatchesPage } from '@/pages/ap-batches/ap-batches-page';
import { ApInvoiceDetailPage } from '@/pages/ap-invoices/ap-invoice-detail-page';
import { DashboardPage } from '@/pages/dashboard';
import { DataTablePage } from '@/pages/data-tables/data-table-page';
import { DataTablesPage } from '@/pages/data-tables/data-tables-page';
import { InterfacesPage } from '@/pages/interfaces/interfaces-page';
import { InvoiceDetailPage } from '@/pages/invoices/invoice-detail-page';
import { InvoicesPage } from '@/pages/invoices/invoices-page';
import { Placeholder } from '@/pages/placeholder';
import { ResponseLogDetailPage } from '@/pages/run-logs/response-log-detail-page';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'interfaces', element: <InterfacesPage /> },
      { path: 'ap-batches', element: <ApBatchesPage /> },
      { path: 'ap-batches/:id', element: <ApBatchDetailPage /> },
      { path: 'ap-invoices/:id', element: <ApInvoiceDetailPage /> },
      { path: 'invoices', element: <InvoicesPage /> },
      { path: 'invoices/:invoiceId', element: <InvoiceDetailPage /> },
      { path: 'response-logs/:id', element: <ResponseLogDetailPage /> },
      { path: 'tables', element: <DataTablesPage /> },
      { path: 'tables/:table', element: <DataTablePage /> },
      { path: '*', element: <Placeholder title="Not found" phase="—" /> },
    ],
  },
]);
