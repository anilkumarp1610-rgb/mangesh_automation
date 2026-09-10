import { CheckCircle2, Pencil, XCircle } from 'lucide-react';
import { FieldList, type Field } from '@/components/field-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useResourceQuery } from '@/lib/use-list';

type Row = Record<string, unknown>;

function val(row: Row, key: string): Field['value'] {
  const v = row[key];
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function secret(row: Row, key: string): Field['value'] {
  return row[`${key}_isSet`] ? (
    <span className="inline-flex items-center gap-1 text-success">
      <CheckCircle2 className="h-3.5 w-3.5" /> set
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <XCircle className="h-3.5 w-3.5" /> not set
    </span>
  );
}

function bool(row: Row, key: string): Field['value'] {
  return row[key] ? 'Yes' : 'No';
}

const SECTIONS: { title: string; fields: (row: Row) => Field[] }[] = [
  {
    title: 'SFTP',
    fields: (r) => [
      { label: 'Host', value: val(r, 'SFTP_Host') },
      { label: 'Port', value: val(r, 'SFTP_Port') },
      { label: 'Username', value: val(r, 'SFTP_UserName') },
      { label: 'Password', value: secret(r, 'SFTP_Password') },
      { label: 'Remote Directory', value: val(r, 'SFTP_RemoteDirectory') },
    ],
  },
  {
    title: 'SMTP / Email',
    fields: (r) => [
      { label: 'Host', value: val(r, 'SMTP_Host') },
      { label: 'Port', value: val(r, 'SMTP_Port') },
      { label: 'User', value: val(r, 'SMTP_UserId') },
      { label: 'Password', value: secret(r, 'SMTP_Password') },
      { label: 'Use TLS', value: bool(r, 'SMTP_UseTLS') },
      { label: 'Email enabled', value: bool(r, 'Email_Enabled') },
      { label: 'Sender', value: val(r, 'Email_Sender_Email') },
      { label: 'Subject', value: val(r, 'Email_Subject') },
      { label: 'Recipients (To)', value: val(r, 'Email_Recipients_To') },
      { label: 'Recipients (Cc)', value: val(r, 'Email_Recipients_Cc') },
    ],
  },
  {
    title: 'Platform API',
    fields: (r) => [
      { label: 'Instance URL', value: val(r, 'Platform_InstanceUrl') },
      { label: 'User', value: val(r, 'Platform_UserId') },
      { label: 'Password', value: secret(r, 'Platform_Password') },
      { label: 'App Auth Key', value: secret(r, 'Platform_AppAuthKey') },
    ],
  },
  {
    title: 'Platform DB',
    fields: (r) => [
      { label: 'Server', value: val(r, 'Platform_DB_Server') },
      { label: 'User', value: val(r, 'Platform_DB_User') },
      { label: 'Password', value: secret(r, 'Platform_DB_Password') },
      { label: 'Database', value: val(r, 'Platform_DB_Name') },
      { label: 'AP Query', value: val(r, 'Platform_DB_AP_Query') },
    ],
  },
  {
    title: 'Output',
    fields: (r) => [
      { label: 'Output Directory', value: val(r, 'Output_Directory') },
      { label: 'Archive Directory', value: val(r, 'Archive_Directory') },
      { label: 'Output type', value: val(r, 'output_type') },
      { label: 'Combined', value: bool(r, 'output_combined') },
    ],
  },
  {
    title: 'Failure Notification',
    fields: (r) => [
      { label: 'Enabled', value: bool(r, 'Failure_Notification_Enabled') },
      { label: 'Subject', value: val(r, 'Failure_Subject') },
      { label: 'Recipients (To)', value: val(r, 'Failure_Recipients_To') },
      { label: 'Recipients (Cc)', value: val(r, 'Failure_Recipients_Cc') },
    ],
  },
];

export function InterfaceDetailSheet({
  interfaceId,
  onOpenChange,
  onEdit,
}: {
  interfaceId: number | null;
  onOpenChange: (open: boolean) => void;
  onEdit?: (id: number) => void;
}) {
  const query = useResourceQuery<Row>(
    `interface-${interfaceId}`,
    `/interfaces/${interfaceId}`,
    interfaceId !== null,
  );
  const row = query.data;

  return (
    <Sheet open={interfaceId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {row ? (row.InterfaceName as string) : 'Interface'}
            {row ? (
              <Badge variant={row.IsActive ? 'default' : 'secondary'}>
                {row.IsActive ? 'Active' : 'Inactive'}
              </Badge>
            ) : null}
          </SheetTitle>
          <SheetDescription>
            {row ? `InterfaceId ${row.InterfaceId}` : 'Loading…'} · secrets are shown as set / not
            set only
          </SheetDescription>
          {row && onEdit && (
            <div className="pt-2">
              <Button size="sm" variant="outline" onClick={() => onEdit(row.InterfaceId as number)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
            </div>
          )}
        </SheetHeader>

        {query.isLoading ? (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : query.error ? (
          <p className="mt-6 text-sm text-destructive">
            {query.error instanceof Error ? query.error.message : 'Failed to load'}
          </p>
        ) : row ? (
          <div className="mt-6 space-y-6">
            {SECTIONS.map((section) => (
              <section key={section.title}>
                <h3 className="mb-3 text-sm font-semibold">{section.title}</h3>
                <FieldList fields={section.fields(row)} />
                <Separator className="mt-6" />
              </section>
            ))}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
