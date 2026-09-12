import logging

import requests

from config import InvoiceApiConfig

logger = logging.getLogger(__name__)


def get_payment_batches(
    cfg: InvoiceApiConfig, token: str, from_date: str, to_date: str, page: int = 1
) -> requests.Response:
    batches_cfg = cfg.get_payment_batches
    url = f"{cfg.base_uri.rstrip('/')}{batches_cfg.endpoint}"
    params = {
        "fromDate": from_date,
        "toDate": to_date,
        "page": page,
        "pageSize": batches_cfg.page_size,
        "sortBy": "createdDate",
        "sortOrder": "desc",
        "export": "false",
    }
    headers = {
        "accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    logger.debug("get_payment_batches: calling GET %s (page=%s)", url, page)
    response = requests.get(url, params=params, headers=headers, timeout=60)
    logger.debug("get_payment_batches: HTTP %s (page=%s)", response.status_code, page)
    return response


def get_invoice_list(
    cfg: InvoiceApiConfig, token: str, payment_file_id, page: int = 1
) -> requests.Response:
    list_cfg = cfg.get_invoice_list
    url = f"{cfg.base_uri.rstrip('/')}{list_cfg.endpoint}"
    params = {
        "paymentFileId": payment_file_id,
        "page": page,
        "pageSize": list_cfg.page_size,
        "sortBy": "createdDate",
        "sortOrder": "desc",
        "expand": str(list_cfg.expand).lower(),
        "export": "false",
    }
    headers = {
        "accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    logger.debug(
        "get_invoice_list: calling GET %s (paymentFileId=%s, page=%s)", url, payment_file_id, page
    )
    response = requests.get(url, params=params, headers=headers, timeout=60)
    logger.debug(
        "get_invoice_list: HTTP %s (paymentFileId=%s, page=%s)",
        response.status_code,
        payment_file_id,
        page,
    )
    return response


def get_invoice(cfg: InvoiceApiConfig, token: str, invoice_number: str) -> requests.Response:
    get_invoice_cfg = cfg.get_invoice
    url = f"{cfg.base_uri.rstrip('/')}{get_invoice_cfg.endpoint}"
    params = {
        "invoiceStatus": get_invoice_cfg.invoice_status,
        "invoiceNumber": invoice_number,
        "page": 1,
        "pageSize": get_invoice_cfg.page_size,
        "sortBy": "createdDate",
        "sortOrder": "desc",
        "expand": str(get_invoice_cfg.expand).lower(),
        "export": "false",
    }
    headers = {
        "accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    return requests.get(url, params=params, headers=headers, timeout=60)
