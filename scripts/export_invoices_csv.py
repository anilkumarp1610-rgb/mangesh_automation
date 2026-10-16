import logging
import os
from datetime import datetime

import pandas as pd

from config import AppConfig
from db import get_engine

logger = logging.getLogger(__name__)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build_ap_batch_filename(
    template: str, ap_batch_date, interface_name: str = "", file_type: str = "csv"
) -> str:
    """CSV filename for one payment file, from its ap_created_date formatted
    mmddyyyy. Default: "<interface_name>_<mmddyyyy>.csv" (e.g. "CBTS_AP_09012026.csv";
    "ap_batch_<mmddyyyy>.csv" if the interface has no name). An interface can
    override it with interfaceconfiguration.Email_Attachment_FileName, a template
    using {ap_batch_date}, {interface_name} and {filename} (the default name
    above, so a legacy "{filename}" value resolves to it). Falls back to today's
    date, logged as a warning, if ap_created_date is missing for that batch.
    The extension follows file_type ("csv"/"xlsx"/"txt"): appended if missing, and a
    .csv/.xlsx/.xls/.txt extension from the template is replaced to match."""
    if not ap_batch_date:
        logger.warning(
            "build_ap_batch_filename: no ap_created_date for this batch -- falling back to today's date"
        )
        ap_batch_date = datetime.now()
    date_text = ap_batch_date.strftime("%m%d%Y")
    default_name = f"{interface_name or 'ap_batch'}_{date_text}"
    name = (template or "").strip().format(
        ap_batch_date=date_text, interface_name=interface_name, filename=default_name
    ) or default_name
    base, ext = os.path.splitext(name)
    if not ext:
        return f"{name}.{file_type}"
    if ext.lower() in (".csv", ".xlsx", ".xls", ".txt"):
        return f"{base}.{file_type}"
    return name


def resolve_output_path(cfg: AppConfig, filename: str) -> str:
    folder = cfg.output.folder
    if not folder:
        raise RuntimeError(
            "interfaceconfiguration.Output_Directory is not set for this interface"
        )
    if not os.path.isabs(folder):
        folder = os.path.join(PROJECT_ROOT, folder)
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, filename)


def export_ap_batch_csv(cfg: AppConfig, payment_file_detail_id: int, ap_batch_date) -> str:
    """AP output CSV for one payment-file batch, driven by
    interfaceconfiguration.Platform_DB_AP_Query (cfg.platform_db_ap_query) -- the
    join/GROUP BY over ap_batch_invoice_details + ap_batch_invoice_allocation_values,
    parameterized by %(ap_payment_file_detail_id)s so the CSV only covers this
    batch. Written to interfaceconfiguration.Output_Directory (cfg.output.folder);
    the filename is built by build_ap_batch_filename from this batch's
    ap_created_date and the interface name (Email_Attachment_FileName optionally
    overrides it). Whether the CSV's first row is a header comes from
    interfaceconfiguration.IncludeHeader (cfg.output.include_header, default True)."""
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

    filename = build_ap_batch_filename(
        cfg.email.attachment.file_name, ap_batch_date, cfg.job.output_prefix, cfg.output.type
    )
    output_path = resolve_output_path(cfg, filename)
    if cfg.output.type == "xlsx":
        export_df.to_excel(
            output_path, index=False, header=cfg.output.include_header, sheet_name="AP Batch"
        )
    elif cfg.output.type == "txt":
        export_df.to_csv(
            output_path, index=False, header=cfg.output.include_header, sep="\t"
        )
    else:
        export_df.to_csv(output_path, index=False, header=cfg.output.include_header)
    logger.info(
        "AP batch export: wrote %d row(s) to %s (ap_payment_file_detail_id=%s)",
        len(export_df),
        output_path,
        payment_file_detail_id,
    )
    return output_path

