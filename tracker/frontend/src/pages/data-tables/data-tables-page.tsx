import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useResourceQuery } from '@/lib/use-list';

interface TableMeta {
  key: string;
  label: string;
  columns: string[];
  pk: string;
}

export function DataTablesPage() {
  const query = useResourceQuery<TableMeta[]>('tables-meta', '/tables');

  return (
    <>
      <PageHeader
        title="Data Tables"
        description="Direct, filterable access to the raw invoice tables."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(query.data ?? []).map((t) => (
          <Link key={t.key} to={`/tables/${t.key}`}>
            <Card className="h-full transition-colors hover:border-primary">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-xs text-muted-foreground">{t.key}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t.columns.length} sortable/filterable columns
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
