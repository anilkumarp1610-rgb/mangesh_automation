import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed py-20 text-center text-muted-foreground">
        <Construction className="h-8 w-8" />
        <p className="text-sm">
          <span className="font-medium text-foreground">{title}</span> lands in {phase}.
        </p>
      </div>
    </>
  );
}
