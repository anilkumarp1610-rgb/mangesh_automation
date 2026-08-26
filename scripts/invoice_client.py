import requests

from config import InvoiceApiConfig


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
