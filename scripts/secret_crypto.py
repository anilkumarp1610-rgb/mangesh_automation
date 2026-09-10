"""AES-256-GCM decryption for the interfaceconfiguration secret columns.

The tracker web app (tracker/) writes SFTP_Password, SMTP_Password,
Platform_Password, Platform_AppAuthKey and Platform_DB_Password encrypted, in the
format:

    enc:v1:<base64( iv[12] | authTag[16] | ciphertext )>

using AES-256-GCM with the key from the INTERFACE_SECRET_KEY environment variable
(32 bytes, base64- or hex-encoded -- the SAME value configured for the tracker
backend). Values without the ``enc:v1:`` prefix are legacy plaintext and are
returned unchanged, so a database mid-rollout keeps working.

Keep this in sync with tracker/backend/src/crypto/secrets.ts.
"""
from __future__ import annotations

import base64
import binascii
import logging
import os

logger = logging.getLogger(__name__)

_PREFIX = "enc:v1:"
_IV_LEN = 12
_TAG_LEN = 16

_KEY_ENV = "INTERFACE_SECRET_KEY"


def _load_key() -> bytes:
    raw = os.environ.get(_KEY_ENV, "").strip()
    if not raw:
        raise RuntimeError(
            f"{_KEY_ENV} is not set -- required to decrypt interfaceconfiguration secrets "
            "written by the tracker. Set it to the same value the tracker backend uses."
        )
    try:
        key = binascii.unhexlify(raw) if len(raw) == 64 and _is_hex(raw) else base64.b64decode(raw)
    except (binascii.Error, ValueError) as exc:
        raise RuntimeError(f"{_KEY_ENV} is not valid base64 or hex: {exc}") from exc
    if len(key) != 32:
        raise RuntimeError(f"{_KEY_ENV} must decode to 32 bytes (AES-256), got {len(key)}")
    return key


def _is_hex(value: str) -> bool:
    try:
        int(value, 16)
        return True
    except ValueError:
        return False


def is_encrypted(value: object) -> bool:
    return isinstance(value, str) and value.startswith(_PREFIX)


def decrypt_secret(stored: object) -> object:
    """Return the plaintext for an ``enc:v1:`` value; pass anything else through."""
    if not is_encrypted(stored):
        return stored

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # lazy: only when needed

    blob = base64.b64decode(stored[len(_PREFIX):])  # type: ignore[index]
    iv, tag, ciphertext = blob[:_IV_LEN], blob[_IV_LEN : _IV_LEN + _TAG_LEN], blob[_IV_LEN + _TAG_LEN :]
    plaintext = AESGCM(_load_key()).decrypt(iv, ciphertext + tag, None)
    return plaintext.decode("utf-8")
