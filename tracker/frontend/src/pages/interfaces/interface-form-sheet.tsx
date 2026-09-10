import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api';
import {
  ALL_FIELDS,
  BOOLEAN_FIELDS,
  SECRET_FIELDS,
  SECTIONS,
  emptyFormValues,
  type FieldDef,
} from './interface-form-fields';

type FormValues = Record<string, string | boolean>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  interfaceId: number | null; // null = create
}

const boolSet = new Set<string>(BOOLEAN_FIELDS);
const secretSet = new Set<string>(SECRET_FIELDS);

function toFormValues(row: Record<string, unknown>): FormValues {
  const values = emptyFormValues();
  for (const f of ALL_FIELDS) {
    if (secretSet.has(f.name)) {
      values[f.name] = ''; // never populate secrets; blank = keep existing
    } else if (boolSet.has(f.name)) {
      values[f.name] = Boolean(row[f.name]);
    } else if (row[f.name] !== null && row[f.name] !== undefined) {
      values[f.name] = String(row[f.name]);
    }
  }
  return values;
}

function toPayload(values: FormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'boolean') {
      payload[key] = value;
      continue;
    }
    const trimmed = value.trim();
    if (trimmed === '') continue; // empty = don't set / leave unchanged
    payload[key] = trimmed;
  }
  return payload;
}

export function InterfaceFormSheet({ open, onOpenChange, interfaceId }: Props) {
  const isEdit = interfaceId !== null;
  const queryClient = useQueryClient();

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ defaultValues: emptyFormValues() });

  const detail = useQuery({
    queryKey: ['interface', interfaceId, 'form'],
    queryFn: () => api.get<{ data: Record<string, unknown> }>(`/interfaces/${interfaceId}`),
    enabled: open && isEdit,
  });

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && detail.data) {
      reset(toFormValues(detail.data.data));
    } else if (!isEdit) {
      reset(emptyFormValues());
    }
  }, [open, isEdit, detail.data, reset]);

  const secretsSet = React.useMemo(() => {
    const row = detail.data?.data ?? {};
    return new Set(SECRET_FIELDS.filter((s) => row[`${s}_isSet`]));
  }, [detail.data]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = toPayload(values);
      return isEdit
        ? api.put(`/interfaces/${interfaceId}`, payload)
        : api.post('/interfaces', payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['interfaces'] });
      if (isEdit) await queryClient.invalidateQueries({ queryKey: ['interface', interfaceId] });
      toast.success(isEdit ? 'Interface updated' : 'Interface created');
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Save failed');
    },
  });

  const renderField = (f: FieldDef) => {
    if (f.type === 'switch') {
      return (
        <div key={f.name} className="flex items-center justify-between rounded-md border p-3">
          <Label htmlFor={f.name} className="cursor-pointer">
            {f.label}
          </Label>
          <Controller
            control={control}
            name={f.name}
            render={({ field }) => (
              <Switch
                id={f.name}
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>
      );
    }

    const isSecret = f.type === 'secret';
    const err = errors[f.name];
    return (
      <div key={f.name} className="space-y-1.5">
        <Label htmlFor={f.name}>
          {f.label}
          {f.name === 'InterfaceName' && <span className="text-destructive"> *</span>}
        </Label>
        {f.type === 'textarea' ? (
          <Textarea id={f.name} rows={3} {...register(f.name)} />
        ) : (
          <Input
            id={f.name}
            type={isSecret ? 'password' : f.type === 'number' ? 'number' : 'text'}
            autoComplete={isSecret ? 'new-password' : 'off'}
            placeholder={
              isSecret && secretsSet.has(f.name as (typeof SECRET_FIELDS)[number])
                ? '•••••••• (unchanged)'
                : f.placeholder
            }
            {...register(f.name, {
              required:
                f.name === 'InterfaceName' ? 'Interface name is required' : false,
            })}
          />
        )}
        {f.hint && !err && <p className="text-xs text-muted-foreground">{f.hint}</p>}
        {isSecret && !err && (
          <p className="text-xs text-muted-foreground">
            Stored encrypted. Leave blank to keep the current value.
          </p>
        )}
        {err && <p className="text-xs text-destructive">{String(err.message)}</p>}
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b p-6">
          <SheetTitle>{isEdit ? 'Edit Interface' : 'New Interface'}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? `Editing InterfaceId ${interfaceId}. Password fields are write-only.`
              : 'Create a new interface configuration. Only the name is required.'}
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit((v) => mutation.mutate(v))}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {isEdit && detail.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <Tabs defaultValue={SECTIONS[0]!.id}>
                <TabsList className="flex h-auto flex-wrap justify-start">
                  {SECTIONS.map((s) => (
                    <TabsTrigger key={s.id} value={s.id}>
                      {s.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {SECTIONS.map((s) => (
                  <TabsContent key={s.id} value={s.id} className="mt-4 space-y-4">
                    {s.fields
                      ? s.fields.map(renderField)
                      : (s.groups ?? []).map((g) => (
                          <section key={g.label} className="space-y-4">
                            <h3 className="border-b pb-1 text-sm font-semibold text-muted-foreground">
                              {g.label}
                            </h3>
                            {g.fields.map(renderField)}
                          </section>
                        ))}
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </div>

          <SheetFooter className="gap-2 border-t p-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || (isEdit && !isDirty)}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? 'Save changes' : 'Create interface'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
