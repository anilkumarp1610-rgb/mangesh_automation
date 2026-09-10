export type FieldType = 'text' | 'number' | 'textarea' | 'switch' | 'secret';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  hint?: string;
}

export interface FieldGroup {
  label: string;
  fields: FieldDef[];
}

export interface FormSection {
  id: string;
  label: string;
  /** Flat list of fields, or grouped sub-sections. Exactly one is set. */
  fields?: FieldDef[];
  groups?: FieldGroup[];
}

export const SECRET_FIELDS = [
  'SFTP_Password',
  'SMTP_Password',
  'Platform_Password',
  'Platform_AppAuthKey',
  'Platform_DB_Password',
] as const;

export const BOOLEAN_FIELDS = [
  'IsActive',
  'SMTP_UseTLS',
  'Email_Enabled',
  'Email_Attachment_Enabled',
  'Failure_Notification_Enabled',
  'output_combined',
] as const;

export const SECTIONS: FormSection[] = [
  {
    id: 'general',
    label: 'General',
    fields: [
      { name: 'InterfaceName', label: 'Interface Name', type: 'text', placeholder: 'CBTS_AP' },
      { name: 'IsActive', label: 'Active', type: 'switch' },
      { name: 'output_type', label: 'Output Type', type: 'text', placeholder: 'Excel / CSV' },
      { name: 'output_combined', label: 'Combine output into one file', type: 'switch' },
      { name: 'Output_Directory', label: 'Output Directory', type: 'text' },
      { name: 'Archive_Directory', label: 'Archive Directory', type: 'text' },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    fields: [
      { name: 'Platform_InstanceUrl', label: 'Instance URL', type: 'text' },
      { name: 'Platform_UserId', label: 'API User', type: 'text' },
      { name: 'Platform_Password', label: 'API Password', type: 'secret' },
      { name: 'Platform_AppAuthKey', label: 'App Auth Key', type: 'secret' },
      { name: 'Platform_DB_Server', label: 'DB Server', type: 'text' },
      { name: 'Platform_DB_User', label: 'DB User', type: 'text' },
      { name: 'Platform_DB_Password', label: 'DB Password', type: 'secret' },
      { name: 'Platform_DB_Name', label: 'DB Name', type: 'text' },
      { name: 'Platform_DB_AP_Query', label: 'AP Query', type: 'textarea' },
    ],
  },
  {
    id: 'sftp',
    label: 'SFTP',
    fields: [
      { name: 'SFTP_Host', label: 'Host', type: 'text' },
      { name: 'SFTP_Port', label: 'Port', type: 'number', placeholder: '22' },
      { name: 'SFTP_UserName', label: 'Username', type: 'text' },
      { name: 'SFTP_Password', label: 'Password', type: 'secret' },
      { name: 'SFTP_RemoteDirectory', label: 'Remote Directory', type: 'text' },
    ],
  },
  {
    id: 'smtp',
    label: 'SMTP',
    fields: [
      { name: 'SMTP_Host', label: 'Host', type: 'text' },
      { name: 'SMTP_Port', label: 'Port', type: 'number', placeholder: '25' },
      { name: 'SMTP_UserId', label: 'User', type: 'text' },
      { name: 'SMTP_Password', label: 'Password', type: 'secret' },
      { name: 'SMTP_UseTLS', label: 'Use TLS', type: 'switch' },
    ],
  },
  {
    id: 'email',
    label: 'Email',
    groups: [
      {
        label: 'Success',
        fields: [
          { name: 'Email_Enabled', label: 'Send success email', type: 'switch' },
          { name: 'Email_Sender_Email', label: 'Sender Email', type: 'text' },
          { name: 'Email_Sender_Name', label: 'Sender Name', type: 'text' },
          {
            name: 'Email_Recipients_To',
            label: 'Recipients (To)',
            type: 'textarea',
            hint: 'Comma / newline separated',
          },
          { name: 'Email_Recipients_Cc', label: 'Recipients (Cc)', type: 'textarea' },
          { name: 'Email_Subject', label: 'Subject', type: 'text' },
          { name: 'Email_Body', label: 'Body', type: 'textarea' },
          { name: 'Email_Attachment_Enabled', label: 'Attach output file', type: 'switch' },
          { name: 'Email_Attachment_FilePath', label: 'Attachment File Path', type: 'text' },
          { name: 'Email_Attachment_FileName', label: 'Attachment File Name', type: 'text' },
        ],
      },
      {
        label: 'Failure',
        fields: [
          {
            name: 'Failure_Notification_Enabled',
            label: 'Send failure notification',
            type: 'switch',
          },
          { name: 'Failure_Subject', label: 'Subject', type: 'text' },
          { name: 'Failure_Body', label: 'Body', type: 'textarea' },
          { name: 'Failure_Recipients_To', label: 'Recipients (To)', type: 'textarea' },
          { name: 'Failure_Recipients_Cc', label: 'Recipients (Cc)', type: 'textarea' },
        ],
      },
    ],
  },
];

export const ALL_FIELDS: FieldDef[] = SECTIONS.flatMap((s) =>
  s.fields ? s.fields : (s.groups ?? []).flatMap((g) => g.fields),
);

/** Form default values for a brand-new interface. */
export function emptyFormValues(): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  for (const f of ALL_FIELDS) {
    values[f.name] = f.type === 'switch' ? false : '';
  }
  values.IsActive = true;
  values.Email_Enabled = true;
  values.Email_Attachment_Enabled = true;
  values.Failure_Notification_Enabled = true;
  return values;
}
