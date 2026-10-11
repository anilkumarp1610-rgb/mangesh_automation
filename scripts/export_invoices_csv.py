import logging
import os
from datetime import datetime

import pandas as pd

from config import AppConfig, ExportTableConfig, load_config
from db import get_engine

logger = logging.getLogger(__name__)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build_export_filename(
    cfg: AppConfig, timestamp: datetime | None = None, suffix: str | None = None
) -> str:
    """Output.FileName from appsettings.yml with a ddMMyyyy_hhmmss timestamp appended,
    prefixed with the running interface's name (Job.OutputPrefix, sourced from
    interfaceconfiguration.InterfaceName) when set. `suffix` (e.g. a payment file's
    batch name) is inserted before the timestamp to keep per-run exports distinct."""
    timestamp = timestamp or datetime.now()
    base, ext = os.path.splitext(cfg.output.file_name)
    if suffix:
        base = f"{base}_{suffix}"
    stamped = f"{base}_{timestamp.strftime('%d%m%Y_%H%M%S')}{ext or '.csv'}"
    return f"{cfg.job.output_prefix}_{stamped}" if cfg.job.output_prefix else stamped


def build_ap_batch_filename(template: str, ap_batch_date) -> str:
    """Resolves interfaceconfiguration.Email_Attachment_FileName (e.g.
    "CBTS_{ap_batch_date}") against one payment file's ap_created_date,
    formatted mmddyyyy (e.g. "CBTS_09012026"). Falls back to today's date,
    logged as a warning, if ap_created_date is missing for that batch (the
    upstream API record didn't carry one). Appends .csv if the template
    doesn't already end in an extension."""
    if not ap_batch_date:
        logger.warning(
            "build_ap_batch_filename: no ap_created_date for this batch -- falling back to today's date"
        )
        ap_batch_date = datetime.now()
    name = template.format(ap_batch_date=ap_batch_date.strftime("%m%d%Y"))
    return name if os.path.splitext(name)[1] else f"{name}.csv"


def resolve_output_path(cfg: AppConfig, filename: str | None = None) -> str:
    folder = cfg.output.folder
    if not os.path.isabs(folder):
        folder = os.path.join(PROJECT_ROOT, folder)
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, filename or cfg.output.file_name)


def build_invoice_export(
    engine, tables: list[ExportTableConfig], invoice_process_uuid: str | None = None
) -> pd.DataFrame:
    if not tables:
        raise ValueError("appsettings.yml Output.Tables must list at least one table")

    base_table = tables[0]
    logger.info("Export: reading base table '%s'", base_table.name)
    if invoice_process_uuid:
        # Scopes the export to a single processing run (base table must be
        # invoice_summary, the only table carrying invoice_process_uuid) --
        # everything joined on afterwards inherits the scoping through invoice_id.
        scoped_query = (
            f"SELECT * FROM ({base_table.query}) AS scoped_base "
            "WHERE invoice_process_uuid = %(invoice_process_uuid)s"
        )
        export_df = pd.read_sql(
            scoped_query, engine, params={"invoice_process_uuid": invoice_process_uuid}
        )
        logger.info(
            "Export: base table returned %d row(s) scoped to invoice_process_uuid=%s",
            len(export_df),
            invoice_process_uuid,
        )
    else:
        export_df = pd.read_sql(base_table.query, engine)
        logger.info("Export: base table returned %d row(s) (unscoped)", len(export_df))

    for table_cfg in tables[1:]:
        if not table_cfg.join_on:
            raise ValueError(
                f"Output.Tables entry '{table_cfg.name}' is missing a JoinOn column"
            )
        logger.info(
            "Export: reading and joining table '%s' on %s",
            table_cfg.name,
            table_cfg.join_on,
        )
        df = pd.read_sql(table_cfg.query, engine)
        export_df = export_df.merge(
            df, on=table_cfg.join_on, how="left", suffixes=("", f"_{table_cfg.name}")
        )

    return export_df


def export_invoices_csv(
    cfg: AppConfig | None = None,
    invoice_process_uuid: str | None = None,
    filename_suffix: str | None = None,
) -> str:
    cfg = cfg or load_config()
    engine = get_engine(cfg.mysql)  # shared pool; disposed by the caller's process
    export_df = build_invoice_export(
        engine, cfg.output.tables, invoice_process_uuid=invoice_process_uuid
    )

    output_path = resolve_output_path(cfg, build_export_filename(cfg, suffix=filename_suffix))
    export_df.to_csv(output_path, index=False, header=cfg.output.include_header)
    logger.info("Export: wrote %d row(s) to %s", len(export_df), output_path)
    return output_path


def export_ap_batch_csv(cfg: AppConfig, payment_file_detail_id: int, ap_batch_date) -> str:
    """AP output CSV for one payment-file batch, driven by
    interfaceconfiguration.Platform_DB_AP_Query (cfg.platform_db_ap_query)
    instead of Output.Tables -- the join/GROUP BY over ap_batch_invoice_details
    + ap_batch_invoice_allocation_values, parameterized by
    %(ap_payment_file_detail_id)s so the CSV only covers this batch. The
    filename comes from interfaceconfiguration.Email_Attachment_FileName
    (cfg.email.attachment.file_name), resolved against this batch's
    ap_created_date (see build_ap_batch_filename). Whether the CSV's first
    row is a header comes from interfaceconfiguration.IncludeHeader
    (cfg.output.include_header, default True)."""
    if not cfg.platform_db_ap_query:
        logger.error(
            "AP batch export: interfaceconfiguration.Platform_DB_AP_Query is not set for "
            "this interface (ap_payment_file_detail_id=%s)",
            payment_file_detail_id,
        )
        raise RuntimeError(
            "interfaceconfiguration.Platform_DB_AP_Query is not set for this interface -- "
            "the AP output CSV query is required to generate the export"
        )

    logger.info(
        "AP batch export: running Platform_DB_AP_Query for ap_payment_file_detail_id=%s",
        payment_file_detail_id,
    )
    export_df = pd.read_sql(
        cfg.platform_db_ap_query,
        get_engine(cfg.mysql),  # shared pool -- connection is returned, not closed
        params={"ap_payment_file_detail_id": payment_file_detail_id},
    )

    filename = build_ap_batch_filename(cfg.email.attachment.file_name, ap_batch_date)
    output_path = resolve_output_path(cfg, filename)
    export_df.to_csv(output_path, index=False, header=cfg.output.include_header)
    logger.info(
        "AP batch export: wrote %d row(s) to %s (ap_payment_file_detail_id=%s)",
        len(export_df),
        output_path,
        payment_file_detail_id,
    )
    return output_path


if __name__ == "__main__":
    path = export_invoices_csv()
    print(f"Wrote invoice export CSV to {path}")
