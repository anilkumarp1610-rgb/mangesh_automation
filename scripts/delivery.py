import logging
import posixpath
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage

import paramiko

from config import EmailConfig, SftpConfig

logger = logging.getLogger(__name__)


def upload_to_sftp(cfg: SftpConfig, local_path: str, filename: str) -> str:
    if not cfg.host or not cfg.username or not cfg.password or "${" in cfg.username or "${" in cfg.password:
        raise RuntimeError(
            "SFTP is not configured (host/username/password missing) -- check "
            "interfaceconfiguration.SFTP_* for this interface, or Sftp.* in appsettings.yml"
        )

    transport = paramiko.Transport((cfg.host, cfg.port))
    try:
        transport.connect(username=cfg.username, password=cfg.password)
        with paramiko.SFTPClient.from_transport(transport) as client:
            remote_path = posixpath.join(cfg.remote_directory, filename)
            client.put(local_path, remote_path)
        logger.info("Uploaded %s to SFTP as %s", local_path, remote_path)
        return remote_path
    finally:
        transport.close()


def _send_message(
    cfg, subject, body, recipients_to, recipients_cc, attachments=None, html: bool = False
):
    """attachments: list of (local_path, attachment_name) tuples, or None."""
    if not cfg.enabled:
        return
    if "${" in cfg.smtp_username or "${" in cfg.smtp_password:
        raise RuntimeError("SMTP credentials are not configured in the environment")

    message = EmailMessage()
    message["From"] = f"{cfg.sender.name} <{cfg.sender.email}>"
    message["To"] = ", ".join(recipients_to)
    if recipients_cc:
        message["Cc"] = ", ".join(recipients_cc)
    message["Subject"] = subject
    if html:
        message.set_content(body, subtype="html")
    else:
        message.set_content(body)

    attachment_names = []
    for attachment_path, attachment_name in attachments or []:
        with open(attachment_path, "rb") as file:
            message.add_attachment(
                file.read(), maintype="application", subtype="octet-stream", filename=attachment_name
            )
        attachment_names.append(attachment_name)

    with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port) as smtp:
        if cfg.use_tls:
            smtp.starttls()
        if cfg.smtp_username:
            smtp.login(cfg.smtp_username, cfg.smtp_password)
        smtp.send_message(message)
    logger.info(
        "Email sent: subject=%r to=%s cc=%s attachments=%s",
        subject,
        recipients_to,
        recipients_cc,
        attachment_names,
    )


def send_success_email(cfg: EmailConfig, filename: str, output_path: str) -> None:
    # filename is already the fully-resolved attachment/CSV name (see
    # export_invoices_csv.build_ap_batch_filename) -- attached as-is, not
    # re-templated against cfg.attachment.file_name a second time.
    _send_message(
        cfg,
        cfg.subject.format(filename=filename),
        cfg.body.format(filename=filename, upload_time=datetime.now(timezone.utc).isoformat()),
        cfg.recipients_to,
        cfg.recipients_cc,
        [(output_path, filename)] if cfg.attachment.enabled else None,
    )


def send_failure_email(cfg: EmailConfig, filename: str, error: Exception) -> None:
    notification = cfg.failure_notification
    if not notification.enabled:
        return
    _send_message(
        cfg,
        notification.subject.format(filename=filename),
        notification.body.format(
            filename=filename,
            failure_time=datetime.now(timezone.utc).isoformat(),
            error_message=str(error),
        ),
        notification.recipients_to,
        notification.recipients_cc,
    )


_NO_BATCH_SUBJECT = "[{interface_name}] No AP batch found - {run_date}"
_NO_BATCH_BODY = """\
<p>The AP invoice run for <b>{interface_name}</b> (Interface ID {interface_id}, Run Log ID {run_log_id}) \
completed on {run_date} but found <b>no AP batch to process</b>.</p>
<table border="1" cellpadding="4" cellspacing="0">
<tr><td><b>Interface</b></td><td>{interface_name} (ID {interface_id})</td></tr>
<tr><td><b>Run Log ID</b></td><td>{run_log_id}</td></tr>
<tr><td><b>Search criteria</b></td><td>{criteria}</td></tr>
<tr><td><b>Batches returned by API</b></td><td>{api_batch_count}</td></tr>
</table>
<p>No CSV was generated and nothing was uploaded to SFTP for this run.</p>
"""


def send_no_batch_email(
    cfg: EmailConfig,
    interface_name: str,
    interface_id: int,
    run_log_id: int,
    run_date: str,
    from_date=None,
    to_date=None,
    ap_batch_name: str = None,
    api_batch_count: int = 0,
) -> None:
    """Standard notification, identical for every interface, for a run whose
    run_log_id produced no AP batch to process. Uses the interface's normal
    Email_* sender/recipients/SMTP settings and Email.Enabled; the subject and
    body are fixed templates (_NO_BATCH_SUBJECT/_NO_BATCH_BODY) so a newly
    configured interface needs no extra setup. The search criteria shown are
    what the run was asked for: the batch name, or the from/to window."""
    if ap_batch_name:
        criteria = f"AP batch name: {ap_batch_name}"
    elif from_date and to_date:
        criteria = f"From {from_date} to {to_date}" if from_date != to_date else f"Date {from_date}"
    else:
        criteria = "Default window"
    format_args = dict(
        interface_name=interface_name,
        interface_id=interface_id,
        run_log_id=run_log_id,
        run_date=run_date,
        criteria=criteria,
        api_batch_count=api_batch_count,
    )
    _send_message(
        cfg,
        _NO_BATCH_SUBJECT.format(**format_args),
        _NO_BATCH_BODY.format(**format_args),
        cfg.recipients_to,
        cfg.recipients_cc,
        html=True,
    )


def send_run_summary_email(
    cfg: EmailConfig,
    interface_name: str,
    run_date: str,
    batch_results: list[dict],
    sftp_path: str = "",
) -> None:
    """One email per process_invoices.py run, listing every payment-file batch
    processed (batch_name, invoice_count, output_filename per entry), with
    every batch's AP output CSV attached. batch_results: list of
    {"batch_name": str, "invoice_count": int, "output_path": str | None,
    "output_filename": str | None, "status": "Success" | "Failure"} -- one
    per batch process_payment_file() attempted this run (see process_invoices.py).

    Body/Subject templates (interfaceconfiguration.Email_Body/Email_Subject)
    are formatted with: {interface_name}, {run_date}, {sftp_path}
    (cfg.sftp.remote_directory, passed in by the caller), {batch_names}
    (comma-joined), {invoice_count} (summed across all batches),
    {output_filenames} (comma-joined), and {batch_rows} -- an HTML
    "<tr>...</tr>" block, one row per batch, for a per-batch table (the
    plain comma-joined fields above are for a single-row-summary style
    instead, matching the reference email this was built from)."""
    if not cfg.enabled or not batch_results:
        return

    batch_names = ", ".join(r["batch_name"] for r in batch_results)
    output_filenames = ", ".join(r["output_filename"] for r in batch_results if r.get("output_filename"))
    invoice_count = sum(r.get("invoice_count") or 0 for r in batch_results)
    batch_rows = "\n".join(
        "<tr><td>{batch_name}</td><td>{invoice_count}</td><td>{output_filename}</td></tr>".format(
            batch_name=r["batch_name"],
            invoice_count=r.get("invoice_count") or 0,
            output_filename=r.get("output_filename") or "-",
        )
        for r in batch_results
    )

    format_args = dict(
        interface_name=interface_name,
        run_date=run_date,
        sftp_path=sftp_path,
        batch_names=batch_names,
        invoice_count=invoice_count,
        output_filenames=output_filenames,
        batch_rows=batch_rows,
    )
    attachments = [
        (r["output_path"], r["output_filename"])
        for r in batch_results
        if r.get("output_path") and r.get("output_filename")
    ]
    try:
        subject = cfg.subject.format(**format_args)
        body = cfg.body.format(**format_args)
    except KeyError as exc:
        raise RuntimeError(
            f"interfaceconfiguration.Email_Subject/Email_Body references {{{exc.args[0]}}}, which "
            f"send_run_summary_email() doesn't provide. Supported placeholders: "
            f"{', '.join(sorted(format_args))}. (This is likely an old per-batch template still "
            f"using {{filename}}/{{upload_time}} -- see sql/update_email_summary_template.sql.)"
        ) from exc
    _send_message(
        cfg,
        subject,
        body,
        cfg.recipients_to,
        cfg.recipients_cc,
        attachments if cfg.attachment.enabled else None,
        html=True,
    )