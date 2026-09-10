import { z } from 'zod';

/**
 * Payload for creating / updating an interfaceconfiguration row. Field names match
 * the DB columns so the frontend can round-trip the detail response.
 *
 * Secret columns accept a plaintext value that the repository encrypts before
 * writing. On update, an omitted or empty-string secret leaves the stored value
 * unchanged.
 */

const trimmedString = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => (s === '' ? undefined : s))
  .optional();

const nullableInt = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return undefined;
    const n = typeof v === 'string' ? Number.parseInt(v, 10) : v;
    return Number.isFinite(n) ? n : undefined;
  });

const boolish = z
  .union([z.boolean(), z.number(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === '') return undefined;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return /^(1|true|yes|on)$/i.test(v);
  });

export const interfaceCreateSchema = z
  .object({
    InterfaceName: z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(200)),

    SFTP_Host: trimmedString,
    SFTP_Port: nullableInt,
    SFTP_UserName: trimmedString,
    SFTP_Password: trimmedString,
    SFTP_RemoteDirectory: trimmedString,

    SMTP_Host: trimmedString,
    SMTP_Port: nullableInt,
    SMTP_UserId: trimmedString,
    SMTP_Password: trimmedString,
    SMTP_UseTLS: boolish,

    Platform_InstanceUrl: trimmedString,
    Platform_UserId: trimmedString,
    Platform_Password: trimmedString,
    Platform_AppAuthKey: trimmedString,
    Platform_DB_Server: trimmedString,
    Platform_DB_User: trimmedString,
    Platform_DB_Password: trimmedString,
    Platform_DB_Name: trimmedString,
    Platform_DB_AP_Query: trimmedString,

    IsActive: boolish,

    Output_Directory: trimmedString,
    Archive_Directory: trimmedString,

    Email_Enabled: boolish,
    Email_Sender_Email: trimmedString,
    Email_Sender_Name: trimmedString,
    Email_Recipients_To: trimmedString,
    Email_Recipients_Cc: trimmedString,
    Email_Subject: trimmedString,
    Email_Body: trimmedString,
    Email_Attachment_Enabled: boolish,
    Email_Attachment_FilePath: trimmedString,
    Email_Attachment_FileName: trimmedString,

    Failure_Notification_Enabled: boolish,
    Failure_Subject: trimmedString,
    Failure_Body: trimmedString,
    Failure_Recipients_To: trimmedString,
    Failure_Recipients_Cc: trimmedString,

    output_combined: boolish,
    output_type: trimmedString,
  })
  .strict();

export const interfaceUpdateSchema = interfaceCreateSchema.partial().extend({
  InterfaceName: interfaceCreateSchema.shape.InterfaceName.optional(),
});

export type InterfaceCreateInput = z.infer<typeof interfaceCreateSchema>;
export type InterfaceUpdateInput = z.infer<typeof interfaceUpdateSchema>;

export const activeSchema = z.object({ isActive: z.boolean() });
