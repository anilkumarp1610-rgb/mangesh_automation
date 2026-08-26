import os
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
class AppConfig:
    mysql: MySqlConfig
    invoice_api: InvoiceApiConfig
    output: OutputConfig
    logging: LoggingConfig


def load_config(path: str = APPSETTINGS_PATH) -> AppConfig:
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    logging_raw = raw.get("Logging", {})
    mysql_raw = raw["MySql"]
    api_raw = raw["InvoiceApi"]
    auth_raw = api_raw["Authentication"]
    get_invoice_raw = api_raw["GetInvoice"]
    output_raw = raw["Output"]

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
    )
