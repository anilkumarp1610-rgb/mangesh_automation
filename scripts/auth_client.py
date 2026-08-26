import logging

import requests

from config import InvoiceApiConfig

logger = logging.getLogger(__name__)


def authenticate(cfg: InvoiceApiConfig) -> str:
    auth_cfg = cfg.authentication
    url = f"{cfg.base_uri.rstrip('/')}{auth_cfg.endpoint}"
    headers = {
        "ClientApiKey": auth_cfg.client_api_key,
        "Content-Type": "application/json",
    }
    body = {
        "loginUserName": auth_cfg.login_user_name,
        "password": auth_cfg.password,
    }

    logger.info("POST %s (user=%s)", url, auth_cfg.login_user_name)
    response = requests.post(url, json=body, headers=headers, timeout=30)
    response.raise_for_status()
    payload = response.json()

    if not payload.get("success"):
        logger.error("Authentication failed: %s", payload.get("message"))
        raise RuntimeError(f"Authentication failed: {payload.get('message')}")

    token = payload.get("data", {}).get("accessToken")
    if not token:
        logger.error("Authentication response did not contain an accessToken")
        raise RuntimeError("Authentication response did not contain an accessToken")

    return token
