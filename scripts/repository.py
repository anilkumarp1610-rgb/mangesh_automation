import json
from datetime import datetime, timezone

from mysql.connector.cursor import MySQLCursor

from field_maps import (
    CHARGE_FIELD_MAP,
    DETAIL_FIELD_MAP,
    SERVICE_FIELD_MAP,
    SUMMARY_FIELD_MAP,
    map_record,
)


def upsert(cursor: MySQLCursor, table: str, data: dict, unique_cols=None) -> int:
    unique_cols = unique_cols or []
    columns = list(data.keys())
    col_list = ", ".join(f"`{c}`" for c in columns)
    placeholders = ", ".join(["%s"] * len(columns))
    update_cols = [c for c in columns if c not in unique_cols]
    sql = f"INSERT INTO `{table}` ({col_list}) VALUES ({placeholders})"
    if update_cols:
        update_clause = ", ".join(f"`{c}`=VALUES(`{c}`)" for c in update_cols)
        sql += f" ON DUPLICATE KEY UPDATE {update_clause}"
    cursor.execute(sql, list(data.values()))
    return cursor.lastrowid


def insert(cursor: MySQLCursor, table: str, data: dict) -> int:
    columns = list(data.keys())
    col_list = ", ".join(f"`{c}`" for c in columns)
    placeholders = ", ".join(["%s"] * len(columns))
    sql = f"INSERT INTO `{table}` ({col_list}) VALUES ({placeholders})"
    cursor.execute(sql, list(data.values()))
    return cursor.lastrowid


def insert_response_log(
    cursor: MySQLCursor,
    invoice_number: str,
    request_url: str,
    http_status_code: int,
    is_success: bool,
    response_message: str,
    response_body,
    error_message: str = None,
) -> int:
    data = {
        "invoice_number": invoice_number,
        "request_url": request_url,
        "http_status_code": http_status_code,
        "is_success": 1 if is_success else 0,
        "response_message": response_message,
        "response_body": json.dumps(response_body) if response_body is not None else None,
        "error_message": error_message,
        "created_datetime": datetime.now(timezone.utc).replace(tzinfo=None),
    }
    return insert(cursor, "invoice_response_log", data)


def upsert_invoice_summary(cursor: MySQLCursor, record: dict, log_id: int) -> int:
    data = map_record(record, SUMMARY_FIELD_MAP)
    data["log_id"] = log_id
    return upsert(cursor, "invoice_summary", data, unique_cols=["invoice_id"])


def upsert_invoice_detail(cursor: MySQLCursor, record: dict, log_id: int) -> int:
    data = map_record(record, DETAIL_FIELD_MAP)
    data["log_id"] = log_id
    return upsert(cursor, "invoice_detail", data, unique_cols=["invoice_id"])


def insert_invoice_line_detail(cursor: MySQLCursor, detail_id: int, service_total_count) -> int:
    data = {
        "detail_id": detail_id,
        "service_total_count": service_total_count,
    }
    return insert(cursor, "invoice_line_detail", data)


def insert_invoice_service(cursor: MySQLCursor, line_detail_id: int, service_record: dict) -> int:
    data = map_record(service_record, SERVICE_FIELD_MAP)
    data["line_detail_id"] = line_detail_id
    return insert(cursor, "invoice_service", data)


def insert_invoice_charge(cursor: MySQLCursor, service_pk: int, charge_record: dict) -> int:
    data = map_record(charge_record, CHARGE_FIELD_MAP)
    data["service_pk"] = service_pk
    return insert(cursor, "invoice_charge", data)


def update_ap_invoice_status(
    cursor: MySQLCursor,
    invoice_number: str,
    api_status: str,
    response_obj,
    response_status_code: int,
) -> None:
    sql = """
        UPDATE airflow.ap_invoices
        SET ap_invoice_api_status = %s,
            api_response_obj = %s,
            api_response_status_code = %s
        WHERE ap_invoice_number = %s
    """
    cursor.execute(
        sql,
        (
            api_status,
            json.dumps(response_obj) if response_obj is not None else None,
            response_status_code,
            invoice_number,
        ),
    )


def store_invoice_record(cursor: MySQLCursor, record: dict, log_id: int) -> None:
    invoice_id = upsert_invoice_summary(cursor, record, log_id)
    detail_id = upsert_invoice_detail(cursor, record, log_id)

    # clear previously stored nested rows for this invoice so re-processing doesn't duplicate them
    # (invoice_service / invoice_charge cascade-delete via FK)
    cursor.execute("DELETE FROM invoice_line_detail WHERE detail_id = %s", (detail_id,))

    for line_detail in record.get("invoiceDetails", []) or []:
        line_detail_id = insert_invoice_line_detail(
            cursor, detail_id, line_detail.get("serviceTotalCount")
        )
        for service_record in line_detail.get("invoiceServices", []) or []:
            service_pk = insert_invoice_service(cursor, line_detail_id, service_record)
            for charge_record in service_record.get("invoiceCharges", []) or []:
                insert_invoice_charge(cursor, service_pk, charge_record)

    _ = invoice_id
