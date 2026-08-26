import logging
import os
from urllib.parse import quote_plus

import pandas as pd
from sqlalchemy import create_engine

from config import AppConfig, ExportTableConfig, MySqlConfig, load_config

logger = logging.getLogger(__name__)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_engine(cfg: MySqlConfig):
    return create_engine(
        f"mysql+mysqlconnector://{cfg.user}:{quote_plus(cfg.password)}@{cfg.host}/{cfg.database}"
    )


def resolve_output_path(cfg: AppConfig) -> str:
    folder = cfg.output.folder
    if not os.path.isabs(folder):
        folder = os.path.join(PROJECT_ROOT, folder)
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, cfg.output.file_name)


def build_invoice_export(engine, tables: list[ExportTableConfig]) -> pd.DataFrame:
    if not tables:
        raise ValueError("appsettings.yml Output.Tables must list at least one table")

    base_table = tables[0]
    logger.info("Export: reading base table '%s'", base_table.name)
    export_df = pd.read_sql(base_table.query, engine)

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


def export_invoices_csv(cfg: AppConfig | None = None) -> str:
    cfg = cfg or load_config()
    engine = get_engine(cfg.mysql)
    try:
        export_df = build_invoice_export(engine, cfg.output.tables)
    finally:
        engine.dispose()

    output_path = resolve_output_path(cfg)
    export_df.to_csv(output_path, index=False)
    logger.info("Export: wrote %d row(s) to %s", len(export_df), output_path)
    return output_path


if __name__ == "__main__":
    path = export_invoices_csv()
    print(f"Wrote invoice export CSV to {path}")
