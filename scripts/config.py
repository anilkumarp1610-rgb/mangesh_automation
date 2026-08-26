import os
import re
from dataclasses import dataclass, field

import yaml

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPSETTINGS_PATH = os.path.join(PROJECT_ROOT, "config", "appsettings.yml")


@dataclass
class LoggingConfig:
    folder: str
    level: str


@dataclass
class MySqlConfig:
    host: str
    user: str
    password: str
    database: str


@dataclass
class AuthenticationConfig:
    endpoint: str
    client_api_key: str
    login_user_name: str
    password: str


@dataclass
class GetInvoiceConfig:
    endpoint: str
    invoice_status: str
    page_size: int
    expand: bool


@dataclass
class InvoiceApiConfig:
    base_uri: str
    authentication: AuthenticationConfig
    get_invoice: GetInvoiceConfig


@dataclass
class ExportTableConfig:
    name: str
    join_on: str | None
    query: str


@dataclass
class OutputConfig:
    folder: str
    file_name: str
    tables: list[ExportTableConfig] = field(default_factory=list)


@dataclass
class JobConfig:
    output_prefix: str


@dataclass
class SftpConfig:
    host: str
    port: int
    username: str
    password: str
    remote_directory: str


@dataclass
class SenderConfig:
    email: str
    name: str


@dataclass
class AttachmentConfig:
    enabled: bool
    file_name: str


@dataclass
class FailureNotificationConfig:
    enabled: bool
    subject: str
    body: str
    recipients_to: list[str] = field(default_factory=list)
    recipients_cc: list[str] = field(default_factory=list)


@dataclass
class EmailConfig:
    enabled: bool
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    use_tls: bool
    sender: SenderConfig
    recipients_to: list[str]
    recipients_cc: list[str]
    subject: str
    body: str
    attachment: AttachmentConfig
    failure_notification: FailureNotificationConfig


@dataclass
class AppConfig:
    mysql: MySqlConfig
    invoice_api: InvoiceApiConfig
    output: OutputConfig
    logging: LoggingConfig
    job: JobConfig
    sftp: SftpConfig
    email: EmailConfig


def _expand_env(value):
    if isinstance(value, str):
        return re.sub(r"\$\{([^}]+)\}", lambda match: os.environ.get(match.group(1), match.group(0)), value)
    if isinstance(value, dict):
        return {key: _expand_env(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_expand_env(item) for item in value]
    return value


def load_config(path: str = APPSETTINGS_PATH) -> AppConfig:
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    def section(name):
        return _expand_env(raw.get(name, {}))

    logging_raw = raw.get("Logging", {})
    mysql_raw = raw["MySql"]
    api_raw = raw["InvoiceApi"]
    auth_raw = api_raw["Authentication"]
    get_invoice_raw = api_raw["GetInvoice"]
    output_raw = raw["Output"]
    job_raw = raw.get("Jobs", {}).get("CBTS_AP", {})
    sftp_raw = section("Sftp")
    email_raw = section("Email")
    smtp_raw = email_raw.get("Smtp", {})
    sender_raw = email_raw.get("Sender", {})
    recipients_raw = email_raw.get("Recipients", {})
    attachment_raw = email_raw.get("Attachment", {})
    failure_raw = email_raw.get("FailureNotification", {})

    return AppConfig(
        logging=LoggingConfig(
            folder=logging_raw.get("Folder", "logs"),
            level=logging_raw.get("Level", "INFO"),
        ),
        mysql=MySqlConfig(
            host=mysql_raw["Host"],
            user=mysql_raw["User"],
            password=mysql_raw["Password"],
            database=mysql_raw["Database"],
        ),
        invoice_api=InvoiceApiConfig(
            base_uri=api_raw["BaseUri"],
            authentication=AuthenticationConfig(
                endpoint=auth_raw["Endpoint"],
                client_api_key=auth_raw["ClientApiKey"],
                login_user_name=auth_raw["LoginUserName"],
                password=auth_raw["Password"],
            ),
            get_invoice=GetInvoiceConfig(
                endpoint=get_invoice_raw["Endpoint"],
                invoice_status=get_invoice_raw.get("InvoiceStatus", "Approved"),
                page_size=get_invoice_raw.get("PageSize", 50),
                expand=get_invoice_raw.get("Expand", True),
            ),
        ),
        output=OutputConfig(
            folder=output_raw["Folder"],
            file_name=output_raw["FileName"],
            tables=[
                ExportTableConfig(
                    name=t["Name"],
                    join_on=t.get("JoinOn"),
                    query=t.get("Query") or f"SELECT * FROM {t['Name']}",
                )
                for t in output_raw.get("Tables", [])
            ],
        ),
        job=JobConfig(output_prefix=job_raw.get("OutputPrefix", "")),
        sftp=SftpConfig(
            host=sftp_raw["Host"],
            port=sftp_raw.get("Port", 22),
            username=sftp_raw["Username"],
            password=sftp_raw["Password"],
            remote_directory=sftp_raw["RemoteDirectory"],
        ),
        email=EmailConfig(
            enabled=email_raw.get("Enabled", False),
            smtp_host=smtp_raw["Host"],
            smtp_port=smtp_raw.get("Port", 25),
            smtp_username=smtp_raw["Username"],
            smtp_password=smtp_raw["Password"],
            use_tls=smtp_raw.get("UseTls", False),
            sender=SenderConfig(**{ "email": sender_raw["Email"], "name": sender_raw["Name"] }),
            recipients_to=recipients_raw.get("To", []),
            recipients_cc=recipients_raw.get("Cc", []),
            subject=email_raw.get("Subject", ""),
            body=email_raw.get("Body", ""),
            attachment=AttachmentConfig(
                enabled=attachment_raw.get("Enabled", False),
                file_name=attachment_raw.get("FileName", "{filename}"),
            ),
            failure_notification=FailureNotificationConfig(
                enabled=failure_raw.get("Enabled", False),
                subject=failure_raw.get("Subject", ""),
                body=failure_raw.get("Body", ""),
                recipients_to=failure_raw.get("Recipients", {}).get("To", []),
                recipients_cc=failure_raw.get("Recipients", {}).get("Cc", []),
            ),
        ),
    )
