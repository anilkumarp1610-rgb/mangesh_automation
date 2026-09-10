import json
import logging
import re
import uuid
from datetime import datetime, timezone

from mysql.connector.cursor import MySQLCursor

from field_maps import (
    CHARGE_FIELD_MAP,
    DETAIL_FIELD_MAP,
    SERVICE_FIELD_MAP,
    SUMMARY_FIELD_MAP,
    map_record,
)
from secret_crypto import decrypt_secret

logger = logging.getLogger(__name__)

# interfaceconfiguration columns the tracker web app stores AES-256-GCM encrypted
# (enc:v1:...). decrypt_secret() passes plaintext values through untouched, so a
# database with a mix of tracker-written and legacy rows still loads.
_SECRET_COLUMNS = (
    "SFTP_Password",
    "SMTP_Password",
    "Platform_Password",
    "Platform_AppAuthKey",
    "Platform_DB_Password",
)

# interfaceconfiguration is a wide table (one row per interface) rather than a
# key-value one, so loading it means mapping its columns onto the dotted
# config.py keys that load_config(interface_values=...) already understands.
# Columns left NULL in the DB are skipped so appsettings.yml keeps supplying
# the default for anything not yet configured for a given interface.
_STRING_COLUMN_KEY_MAP = {
    "SFTP_Host": "Sftp.Host",
    "SFTP_Port": "Sftp.Port",
    "SFTP_UserName": "Sftp.Username",
    "SFTP_Password": "Sftp.Password",
    "SFTP_RemoteDirectory": "Sftp.RemoteDirectory",
    "SMTP_Host": "Email.Smtp.Host",
    "SMTP_Port": "Email.Smtp.Port",
    "SMTP_UserId": "Email.Smtp.Username",
    "SMTP_Password": "Email.Smtp.Password",
    "Platform_InstanceUrl": "InvoiceApi.BaseUri",
    "Platform_UserId": "InvoiceApi.Authentication.LoginUserName",
    "Platform_Password": "InvoiceApi.Authentication.Password",
    "Platform_AppAuthKey": "InvoiceApi.Authentication.ClientApiKey",
    "Email_Sender_Email": "Email.Sender.Email",
    "Email_Sender_Name": "Email.Sender.Name",
    "Email_Subject": "Email.Subject",
    "Email_Body": "Email.Body",
    "Email_Attachment_FileName": "Email.Attachment.FileName",
    "Failure_Subject": "Email.FailureNotification.Subject",
    "Failure_Body": "Email.FailureNotification.Body",
    "Output_Directory": "Output.Folder",
    # Replaces the old hardcoded Jobs.CBTS_AP.OutputPrefix lookup: whichever
    # interface is running gets its own name as the output filename prefix,
    # with no per-interface config needed.
    "InterfaceName": "Job.OutputPrefix",
}
_BOOLEAN_COLUMN_KEY_MAP = {
    "SMTP_UseTLS": "Email.Smtp.UseTls",
    "Email_Enabled": "Email.Enabled",
    "Email_Attachment_Enabled": "Email.Attachment.Enabled",
    "Failure_Notification_Enabled": "Email.FailureNotification.Enabled",
}
_LIST_COLUMN_KEY_MAP = {
    "Email_Recipients_To": "Email.Recipients.To",
    "Email_Recipients_Cc": "Email.Recipients.Cc",
    "Failure_Recipients_To": "Email.FailureNotification.Recipients.To",
    "Failure_Recipients_Cc": "Email.FailureNotification.Recipients.Cc",
}


def _parse_recipient_list(value: str) -> list:
    value = value.strip()
    if not value:
        return []
    if value.startswith("["):
        try:
            return json.loads(value)
        except ValueError:
            pass
    return [item.strip() for item in re.split(r"[,;]", value) if item.strip()]


def load_interface_configuration(cursor: MySQLCursor, interface_id: int) -> dict:
    cursor.execute(
        "SELECT * FROM interfaceconfiguration WHERE InterfaceId = %s AND IsActive = 1",
        (interface_id,),
    )
    row = cursor.fetchone()
    if row is None:
        logger.error(
            "No active interfaceconfiguration row for InterfaceId=%s (either it doesn't "
            "exist, or IsActive=0)",
            interface_id,
        )
        raise ValueError(f"No active interfaceconfiguration row for InterfaceId={interface_id}")
    if not isinstance(row, dict):
        columns = [d[0] for d in cursor.description]
        row = dict(zip(columns, row))

    for column in _SECRET_COLUMNS:
        if row.get(column):
            try:
                row[column] = decrypt_secret(row[column])
            except Exception:
                logger.exception(
                    "Could not decrypt interfaceconfiguration.%s for InterfaceId=%s -- "
                    "check INTERFACE_SECRET_KEY matches the tracker backend",
                    column,
                    interface_id,
                )
                raise

    values = {}
    for column, dotted_key in _STRING_COLUMN_KEY_MAP.items():
        value = row.get(column)
        if value not in (None, ""):
            values[dotted_key] = value
    for column, dotted_key in _BOOLEAN_COLUMN_KEY_MAP.items():
        value = row.get(column)
        if value is not None:
            values[dotted_key] = bool(value)
    for column, dotted_key in _LIST_COLUMN_KEY_MAP.items():
        value = row.get(column)
        if value:
            values[dotted_key] = _parse_recipient_list(value)
    logger.debug(
        "interfaceconfiguration InterfaceId=%s: resolved %d overlay key(s): %s",
        interface_id,
        len(values),
        sorted(values.keys()),
    )
    return values


def get_open_payment_files(cursor: MySQLCursor, interface_id: int) -> list:
    cursor.execute(
        """
        SELECT id, ap_batch_name, ap_batch_payment_file_id, interface_id, ap_batch_status
        FROM ap_payment_file_details
        WHERE interface_id = %s AND ap_batch_status = 'New'
        """,
        (interface_id,),
    )
    rows = cursor.fetchall()
    logger.debug(
        "ap_payment_file_details: %d row(s) with ap_batch_status='New' for interface_id=%s",
        len(rows),
        interface_id,
    )
    return rows


def get_invoice_numbers_for_payment_file(cursor: MySQLCursor, payment_file_detail_id: int) -> list:
    cursor.execute(
        """
        SELECT DISTINCT ap_invoice_number
        FROM ap_invoices
        WHERE ap_paymentfile_id = %s AND ap_invoice_number IS NOT NULL
        """,
        (payment_file_detail_id,),
    )
    rows = cursor.fetchall()
    invoice_numbers = [row["ap_invoice_number"] if isinstance(row, dict) else row[0] for row in rows]
    logger.debug(
        "ap_invoices: %d invoice number(s) found for ap_paymentfile_id=%s",
        len(invoice_numbers),
        payment_file_detail_id,
    )
    return invoice_numbers


def create_process_log(cursor: MySQLCursor, payment_file_detail_id: int):
    process_uuid = str(uuid.uuid4())
    data = {
        "proces_datetime": datetime.now(timezone.utc).replace(tzinfo=None),
        "invoice_process_uuid": process_uuid,
        "ap_payment_file_detail_id": payment_file_detail_id,
    }
    log_id = insert(cursor, "ap_invoices_process_log", data)
    logger.debug(
        "ap_invoices_process_log: inserted id=%s uuid=%s for ap_payment_file_detail_id=%s",
        log_id,
        process_uuid,
        payment_file_detail_id,
    )
    return log_id, process_uuid


def update_payment_file_status(
    cursor: MySQLCursor, payment_file_detail_id: int, status: str, log_id: int
) -> None:
    cursor.execute(
        """
        UPDATE ap_payment_file_details
        SET ap_batch_status = %s, processed_date = %s, log_id = %s
        WHERE id = %s
        """,
        (status, datetime.now(timezone.utc).replace(tzinfo=None), log_id, payment_file_detail_id),
    )
    logger.debug(
        "ap_payment_file_details id=%s: ap_batch_status set to '%s' (log_id=%s)",
        payment_file_detail_id,
        status,
        log_id,
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
    invoice_process_uuid: str = None,
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
        "invoice_process_uuid": invoice_process_uuid,
    }
    return insert(cursor, "invoice_response_log", data)


def upsert_invoice_summary(
    cursor: MySQLCursor,
    record: dict,
    log_id: int,
    invoice_process_uuid: str,
    ap_payment_file_detail_id: int,
) -> int:
    data = map_record(record, SUMMARY_FIELD_MAP)
    data["log_id"] = log_id
    data["invoice_process_uuid"] = invoice_process_uuid
    data["ap_payment_file_detail_id"] = ap_payment_file_detail_id
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
        UPDATE ap_invoices
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


def store_invoice_record(
    cursor: MySQLCursor,
    record: dict,
    log_id: int,
    invoice_process_uuid: str,
    ap_payment_file_detail_id: int,
) -> None:
    invoice_id = upsert_invoice_summary(
        cursor, record, log_id, invoice_process_uuid, ap_payment_file_detail_id
    )
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
