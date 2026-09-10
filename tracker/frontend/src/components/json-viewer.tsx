import { Check, Copy } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface JsonViewerProps {
  value: unknown;
  className?: string;
  maxHeight?: number;
}

export function JsonViewer({ value, className, maxHeight = 480 }: JsonViewerProps) {
  const [copied, setCopied] = React.useState(false);

  const text = React.useMemo(() => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    return JSON.stringify(value, null, 2);
  }, [value]);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!text) {
    return <p className={cn('text-sm text-muted-foreground', className)}>No data</p>;
  }

  return (
    <div className={cn('relative rounded-md border bg-muted/40', className)}>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-7 w-7"
        onClick={copy}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      <pre
        className="overflow-auto p-4 text-xs leading-relaxed scrollbar-thin"
        style={{ maxHeight }}
      >
        {text}
      </pre>
    </div>
  );
}
