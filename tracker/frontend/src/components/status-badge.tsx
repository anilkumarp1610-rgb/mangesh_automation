import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const MAP: Record<string, string> = {
  success: 'border-transparent bg-success/15 text-success',
  new: 'border-transparent bg-blue-500/15 text-blue-600 dark:text-blue-400',
  pending: 'border-transparent bg-warning/15 text-warning',
  failure: 'border-transparent bg-destructive/15 text-destructive',
  failed: 'border-transparent bg-destructive/15 text-destructive',
};

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const key = value.toLowerCase();
  return (
    <Badge variant="outline" className={cn('font-medium', MAP[key])}>
      {value}
    </Badge>
  );
}
