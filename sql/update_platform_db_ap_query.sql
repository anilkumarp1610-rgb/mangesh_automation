-- ============================================================================
-- Sets interfaceconfiguration.Platform_DB_AP_Query and Email_Attachment_FileName
-- for InterfaceId = 1 (CBTS_AP). Run this file directly (don't paste it into a
-- command-line -e "..." argument or a shell prompt) -- that's the likely cause
-- of a "syntax error near %(ap_payment_file_detail_id)s": a shell/CLI tool
-- interpreting the bare % before MySQL ever sees the text. Plain MySQL has no
-- issue with % inside a quoted string literal.
--
-- Prerequisite: Platform_DB_AP_Query should already be LONGTEXT --
-- see sql/apply_logging_changes.sql or run this first if not yet done:
--   ALTER TABLE interfaceconfiguration MODIFY COLUMN Platform_DB_AP_Query LONGTEXT;
-- ============================================================================

USE airflow_new;

UPDATE interfaceconfiguration
SET Platform_DB_AP_Query = 'SELECT d.invoice_date, d.account_number, d.vendor_code, d.payment_due_date, d.invoice_amount, d.invoice_number, a.allocation1, SUM(a.allocated_charges) AS allocated_charges FROM ap_batch_invoice_details d JOIN ap_batch_invoice_allocation_values a ON a.batch_invoice_detail_id = d.id WHERE d.ap_payment_file_detail_id = %(ap_payment_file_detail_id)s GROUP BY d.invoice_date, d.account_number, d.vendor_code, d.payment_due_date, d.invoice_amount, d.invoice_number, a.allocation1'
WHERE InterfaceId = 1;

UPDATE interfaceconfiguration
SET Email_Attachment_FileName = 'CBTS_{ap_batch_date}'
WHERE InterfaceId = 1;

-- Verify:
SELECT InterfaceId, Platform_DB_AP_Query, Email_Attachment_FileName
FROM interfaceconfiguration
WHERE InterfaceId = 1;
