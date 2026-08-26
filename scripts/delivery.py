import logging
import os
import posixpath
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage

import paramiko

from config import EmailConfig, SftpConfig

logger = logging.getLogger(__name__)


def upload_to_sftp(cfg: SftpConfig, local_path: str, filename: str) -> str:
    if "${" in cfg.username or "${" in cfg.password:
        raise RuntimeError("SFTP credentials are not configured in the environment")

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


def _send_message(cfg, subject, body, recipients_to, recipients_cc, attachment_path=None, attachment_name=None):
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
    message.set_content(body)

    if attachment_path:
        with open(attachment_path, "rb") as file:
            message.add_attachment(file.read(), maintype="application", subtype="octet-stream", filename=attachment_name)

    with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port) as smtp:
        if cfg.use_tls:
            smtp.starttls()
        if cfg.smtp_username:
            smtp.login(cfg.smtp_username, cfg.smtp_password)
        smtp.send_message(message)
    logger.info(
        "Email sent: subject=%r to=%s cc=%s attachment=%s",
        subject,
        recipients_to,
        recipients_cc,
        attachment_name if attachment_path else None,
    )


def send_success_email(cfg: EmailConfig, filename: str, output_path: str) -> None:
    attachment_name = cfg.attachment.file_name.format(filename=filename)
    _send_message(
        cfg,
        cfg.subject.format(filename=filename),
        cfg.body.format(filename=filename, upload_time=datetime.now(timezone.utc).isoformat()),
        cfg.recipients_to,
        cfg.recipients_cc,
        output_path if cfg.attachment.enabled else None,
        attachment_name,
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