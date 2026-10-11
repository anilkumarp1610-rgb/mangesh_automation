import os
import re
from dataclasses import dataclass, field

import yaml
from dotenv import load_dotenv

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPSETTINGS_PATH = os.path.join(PROJECT_ROOT, "config", "appsettings.yml")
# The pipeline's own env file (MYSQL_* settings and INTERFACE_SECRET_KEY), kept at
# the project root -- independent of the tracker. PIPELINE_ENV_FILE points at a
# different file (e.g. on the Airflow server); real environment variables always
# win over the file.
DEFAULT_ENV_FILE = os.path.join(PROJECT_ROOT, ".env")


@dataclass
class LoggingConfig:
    level: str


@dataclass
class MySqlConfig:
    host: str
    user: str
    password: str
    database: str
    port: int = 3306
    pool_size: int = 5  # MYSQL_POOL_SIZE -- see db.py


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
class GetPaymentBatchesConfig:
    endpoint: str
    page_size: int
    lookback_days: int


@dataclass
class GetInvoiceListConfig:
    endpoint: str
    page_size: int
    expand: bool


@dataclass
class InvoiceApiConfig:
    base_uri: str
    authentication: AuthenticationConfig
    get_invoice: GetInvoiceConfig
    get_payment_batches: GetPaymentBatchesConfig
    get_invoice_list: GetInvoiceListConfig


@dataclass
class OutputConfig:
    # Both sourced from interfaceconfiguration (see
    # repository.py::load_interface_configuration), not from appsettings.yml:
    # Output_Directory -> folder ("" until the interface row is loaded; main()
    # refuses to run without it) and IncludeHeader -> include_header (whether
    # the generated CSV's first row is a header row; defaults true).
    folder: str = ""
    include_header: bool = True


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
    # Sourced from interfaceconfiguration.Platform_DB_AP_Query (see
    # repository.py::load_interface_configuration) -- the AP output CSV query,
    # parameterized with %(ap_payment_file_detail_id)s. Empty when not yet
    # configured for the running interface.
    platform_db_ap_query: str = ""


def _expand_env(value):
    if isinstance(value, str):
        return re.sub(r"\$\{([^}]+)\}", lambda match: os.environ.get(match.group(1), match.group(0)), value)
    if isinstance(value, dict):
        return {key: _expand_env(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_expand_env(item) for item in value]
    return value


def _set_nested(raw: dict, key: str, value) -> None:
    parts = key.split(".")
    target = raw
    for part in parts[:-1]:
        target = target.setdefault(part, {})
    target[parts[-1]] = value


def _load_mysql_config() -> MySqlConfig:
    """DB connection settings come from MYSQL_* environment variables (loaded from
    the env file first, see DEFAULT_ENV_FILE) -- never from appsettings.yml."""
    load_dotenv(os.environ.get("PIPELINE_ENV_FILE") or DEFAULT_ENV_FILE, override=False)
    missing = [
        name
        for name in ("MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE")
        if not os.environ.get(name)
    ]
    if missing:
        raise RuntimeError(
            f"Missing environment variable(s): {', '.join(missing)}. Set them in the "
            f"environment, or in the env file ({os.environ.get('PIPELINE_ENV_FILE') or DEFAULT_ENV_FILE}; "
            "override the path with PIPELINE_ENV_FILE)."
        )
    return MySqlConfig(
        host=os.environ["MYSQL_HOST"],
        user=os.environ["MYSQL_USER"],
        password=os.environ["MYSQL_PASSWORD"],
        database=os.environ["MYSQL_DATABASE"],
        port=int(os.environ.get("MYSQL_PORT") or 3306),
        pool_size=int(os.environ.get("MYSQL_POOL_SIZE") or 5),
    )


def load_config(path: str = APPSETTINGS_PATH, interface_values: dict | None = None) -> AppConfig:
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    for key, value in (interface_values or {}).items():
        _set_nested(raw, key, value)

    def section(name):
        return _expand_env(raw.get(name, {}))

    logging_raw = raw.get("Logging", {})
    api_raw = raw["InvoiceApi"]
    auth_raw = api_raw["Authentication"]
    get_invoice_raw = api_raw["GetInvoice"]
    get_payment_batches_raw = api_raw.get("GetPaymentBatches", {})
    get_invoice_list_raw = api_raw.get("GetInvoiceList", {})
    output_raw = raw.get("Output", {})
    # Not hardcoded to one interface: repository.py::load_interface_configuration
    # overlays interfaceconfiguration.InterfaceName onto Job.OutputPrefix, so this
    # resolves per whichever --interface-id is actually running.
    job_raw = raw.get("Job", {})
    platform_db_raw = raw.get("PlatformDb", {})
    sftp_raw = section("Sftp")
    email_raw = section("Email")
    smtp_raw = email_raw.get("Smtp", {})
    sender_raw = email_raw.get("Sender", {})
    recipients_raw = email_raw.get("Recipients", {})
    attachment_raw = email_raw.get("Attachment", {})
    failure_raw = email_raw.get("FailureNotification", {})

    return AppConfig(
        logging=LoggingConfig(level=logging_raw.get("Level", "INFO")),
        mysql=_load_mysql_config(),
        invoice_api=InvoiceApiConfig(
            base_uri=api_raw["BaseUri"],
            authentication=AuthenticationConfig(
                endpoint=auth_raw["Endpoint"],
                client_api_key=auth_raw.get("ClientApiKey", ""),
                login_user_name=auth_raw.get("LoginUserName", ""),
                password=auth_raw.get("Password", ""),
            ),
            get_invoice=GetInvoiceConfig(
                endpoint=get_invoice_raw["Endpoint"],
                invoice_status=get_invoice_raw.get("InvoiceStatus", "Approved"),
                page_size=get_invoice_raw.get("PageSize", 50),
                expand=get_invoice_raw.get("Expand", True),
            ),
            get_payment_batches=GetPaymentBatchesConfig(
                endpoint=get_payment_batches_raw.get("Endpoint", "/invoices/invoiceAPBatches"),
                page_size=get_payment_batches_raw.get("PageSize", 50),
                lookback_days=get_payment_batches_raw.get("LookbackDays", 1),
            ),
            get_invoice_list=GetInvoiceListConfig(
                endpoint=get_invoice_list_raw.get("Endpoint", "/invoices/invoiceAPBatchesDetails"),
                page_size=get_invoice_list_raw.get("PageSize", 50),
                expand=get_invoice_list_raw.get("Expand", True),
            ),
        ),
        output=OutputConfig(
            folder=output_raw.get("Folder", ""),
            include_header=output_raw.get("IncludeHeader", True),
        ),
        job=JobConfig(output_prefix=job_raw.get("OutputPrefix", "")),
        sftp=SftpConfig(
            host=sftp_raw.get("Host", ""),
            port=sftp_raw.get("Port", 22),
            username=sftp_raw.get("Username", ""),
            password=sftp_raw.get("Password", ""),
            remote_directory=sftp_raw.get("RemoteDirectory", ""),
        ),
        email=EmailConfig(
            enabled=email_raw.get("Enabled", False),
            smtp_host=smtp_raw.get("Host", ""),
            smtp_port=smtp_raw.get("Port", 25),
            smtp_username=smtp_raw.get("Username", ""),
            smtp_password=smtp_raw.get("Password", ""),
            use_tls=smtp_raw.get("UseTls", False),
            sender=SenderConfig(
                email=sender_raw.get("Email", ""), name=sender_raw.get("Name", "")
            ),
            recipients_to=recipients_raw.get("To", []),
            recipients_cc=recipients_raw.get("Cc", []),
            subject=email_raw.get("Subject", ""),
            body=email_raw.get("Body", ""),
            attachment=AttachmentConfig(
                enabled=attachment_raw.get("Enabled", False),
                file_name=attachment_raw.get("FileName", ""),
            ),
            failure_notification=FailureNotificationConfig(
                enabled=failure_raw.get("Enabled", False),
                subject=failure_raw.get("Subject", ""),
                body=failure_raw.get("Body", ""),
                recipients_to=failure_raw.get("Recipients", {}).get("To", []),
                recipients_cc=failure_raw.get("Recipients", {}).get("Cc", []),
            ),
        ),
        platform_db_ap_query=platform_db_raw.get("ApQuery", ""),
    )
