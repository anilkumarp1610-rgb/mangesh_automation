-- ============================================================================
-- Sets interfaceconfiguration.Email_Subject / Email_Body for InterfaceId = 1
-- to match the reference "AP created on ..." summary email. Email_Body is now
-- sent as HTML (see delivery.py::send_run_summary_email), so it can contain a
-- real <table> instead of plain text.
--
-- >>> EDIT THE SUBJECT LINE BELOW -- it's a placeholder guess, the real text
-- >>> wasn't visible in the reference screenshot.
--
-- Placeholders available in both Subject and Body (filled in per run by
-- send_run_summary_email -- see delivery.py):
--   {interface_name}    e.g. "CBTS Technology Solutions LLC" (interfaceconfiguration.InterfaceName)
--   {run_date}           e.g. "09/16/2026" (today's date when the run executed)
--   {sftp_path}          interfaceconfiguration.SFTP_RemoteDirectory
--   {batch_names}        every ApBatchName processed this run, comma-joined
--   {invoice_count}      total invoice count, summed across all batches
--   {output_filenames}   every AP output CSV filename generated this run, comma-joined
-- ============================================================================

USE airflow_new;

UPDATE interfaceconfiguration
SET Email_Subject = 'AP File Created - {interface_name} - {run_date}'
WHERE InterfaceId = 1;

UPDATE interfaceconfiguration
SET Email_Body = '<html><body>
<p>Hi Team,</p>
<p>The AP created on {run_date} for {interface_name} is attached. The associated invoices are saved on the sFTP path below.</p>
<p><i>{sftp_path}</i></p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
<tr style="background-color:#f2f2f2;"><th>AP Batches from platform</th><th>Count Of Invoices</th><th>Output file name uploaded on SFTP</th></tr>
<tr><td>{batch_names}</td><td>{invoice_count}</td><td>{output_filenames}</td></tr>
</table>
<p>Thank you,<br>IT-Integration,<br>Sakon Inc.</p>
<p><i>(Note: This is an automated message sent from a mailbox, which is not monitored. Please do not reply to it directly.)</i></p>
</body></html>'
WHERE InterfaceId = 1;

-- Verify:
SELECT InterfaceId, Email_Subject, Email_Body FROM interfaceconfiguration WHERE InterfaceId = 1;
