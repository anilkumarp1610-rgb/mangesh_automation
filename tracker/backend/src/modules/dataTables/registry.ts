import type { ListConfig } from '../../lib/listQuery.js';

export interface TableDef {
  key: string;
  label: string;
  table: string;
  alias: string;
  pk: string;
  /** JSON columns to parse on single-row fetch. */
  jsonColumns?: string[];
  listConfig: ListConfig;
}

const num = { type: 'number' as const };
const str = { type: 'string' as const };
const date = { type: 'date' as const };

export const TABLES: Record<string, TableDef> = {
  invoice_summary: {
    key: 'invoice_summary',
    label: 'Invoice Summary',
    table: 'invoice_summary',
    alias: 't',
    pk: 'summary_id',
    listConfig: {
      defaultSort: { field: 'summary_id', order: 'desc' },
      fields: {
        summary_id: { column: 't.summary_id', ...num },
        invoice_id: { column: 't.invoice_id', ...num },
        invoice_number: { column: 't.invoice_number', ...str },
        account_number: { column: 't.account_number', ...str },
        account_id: { column: 't.account_id', ...num },
        total_amount_due: { column: 't.total_amount_due', ...num },
        amount_to_pay: { column: 't.amount_to_pay', ...num },
        currency_symbol: { column: 't.currency_symbol', ...str },
        account_service_type: { column: 't.account_service_type', ...str },
        billing_date: { column: 't.billing_date', ...date },
        due_date: { column: 't.due_date', ...date },
        log_id: { column: 't.log_id', ...num },
        invoice_process_uuid: { column: 't.invoice_process_uuid', ...str },
        ap_payment_file_detail_id: { column: 't.ap_payment_file_detail_id', ...num },
        fetched_datetime: { column: 't.fetched_datetime', ...date },
      },
    },
  },
  invoice_detail: {
    key: 'invoice_detail',
    label: 'Invoice Detail',
    table: 'invoice_detail',
    alias: 't',
    pk: 'detail_id',
    listConfig: {
      defaultSort: { field: 'detail_id', order: 'desc' },
      fields: {
        detail_id: { column: 't.detail_id', ...num },
        invoice_id: { column: 't.invoice_id', ...num },
        invoice_number: { column: 't.invoice_number', ...str },
        organization: { column: 't.organization', ...str },
        vendor_name: { column: 't.vendor_name', ...str },
        invoice_step: { column: 't.invoice_step', ...str },
        invoice_type: { column: 't.invoice_type', ...str },
        account_number: { column: 't.account_number', ...str },
        total_amount_due: { column: 't.total_amount_due', ...num },
        amount_to_pay: { column: 't.amount_to_pay', ...num },
        current_charges: { column: 't.current_charges', ...num },
        billing_date: { column: 't.billing_date', ...date },
        due_date: { column: 't.due_date', ...date },
        invoice_variance_amount: { column: 't.invoice_variance_amount', ...num },
        invoice_variance_percentage: { column: 't.invoice_variance_percentage', ...num },
        account_service_type: { column: 't.account_service_type', ...str },
        log_id: { column: 't.log_id', ...num },
        fetched_datetime: { column: 't.fetched_datetime', ...date },
      },
    },
  },
  invoice_line_detail: {
    key: 'invoice_line_detail',
    label: 'Invoice Line Detail',
    table: 'invoice_line_detail',
    alias: 't',
    pk: 'line_detail_id',
    listConfig: {
      defaultSort: { field: 'line_detail_id', order: 'desc' },
      fields: {
        line_detail_id: { column: 't.line_detail_id', ...num },
        detail_id: { column: 't.detail_id', ...num },
        service_total_count: { column: 't.service_total_count', ...num },
        created_datetime: { column: 't.created_datetime', ...date },
      },
    },
  },
  invoice_service: {
    key: 'invoice_service',
    label: 'Invoice Service',
    table: 'invoice_service',
    alias: 't',
    pk: 'service_pk',
    listConfig: {
      defaultSort: { field: 'service_pk', order: 'desc' },
      fields: {
        service_pk: { column: 't.service_pk', ...num },
        line_detail_id: { column: 't.line_detail_id', ...num },
        service_index: { column: 't.service_index', ...num },
        api_invoice_detail_id: { column: 't.api_invoice_detail_id', ...num },
        sakon_service_id: { column: 't.sakon_service_id', ...num },
        service_id: { column: 't.service_id', ...str },
        btn: { column: 't.btn', ...str },
        sub_account_number: { column: 't.sub_account_number', ...str },
      },
    },
  },
  invoice_charge: {
    key: 'invoice_charge',
    label: 'Invoice Charge',
    table: 'invoice_charge',
    alias: 't',
    pk: 'charge_pk',
    listConfig: {
      defaultSort: { field: 'charge_pk', order: 'desc' },
      fields: {
        charge_pk: { column: 't.charge_pk', ...num },
        service_pk: { column: 't.service_pk', ...num },
        invoice_charge_usage_id: { column: 't.invoice_charge_usage_id', ...num },
        sakon_service_detail_id: { column: 't.sakon_service_detail_id', ...num },
        component1_type: { column: 't.component1_type', ...str },
        component: { column: 't.component', ...str },
        description: { column: 't.description', ...str },
        current_month_charges: { column: 't.current_month_charges', ...num },
        previous_month_charges: { column: 't.previous_month_charges', ...num },
        inventory_charge: { column: 't.inventory_charge', ...num },
        expected_rate: { column: 't.expected_rate', ...num },
        usage_unit1_label: { column: 't.usage_unit1_label', ...str },
        usage_unit1_value: { column: 't.usage_unit1_value', ...num },
        usage_unit2_label: { column: 't.usage_unit2_label', ...str },
        usage_unit2_value: { column: 't.usage_unit2_value', ...num },
      },
    },
  },
};
