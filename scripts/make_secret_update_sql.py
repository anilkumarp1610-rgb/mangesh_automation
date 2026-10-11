"""Prints an UPDATE statement that stores Platform_Password and Platform_AppAuthKey
for one interface as ``enc:v1:`` values (AES-256-GCM, the format secret_crypto.py
and the tracker use), so you can run it in any SQL client.

Prompts for the two secrets (input hidden, nothing is stored or logged) and needs
INTERFACE_SECRET_KEY set to the same value the tracker backend uses:

    python scripts/make_secret_update_sql.py --interface-id 1
"""
import argparse
import base64
import getpass
import os
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from secret_crypto import _PREFIX, _load_key  # noqa: E402


def encrypt_secret(plaintext: str) -> str:
    """Inverse of secret_crypto.decrypt_secret: enc:v1:<base64(iv | tag | ciphertext)>."""
    iv = os.urandom(12)
    sealed = AESGCM(_load_key()).encrypt(iv, plaintext.encode("utf-8"), None)  # ciphertext | tag
    ciphertext, tag = sealed[:-16], sealed[-16:]
    return _PREFIX + base64.b64encode(iv + tag + ciphertext).decode("ascii")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--interface-id", type=int, required=True)
    args = parser.parse_args()

    app_auth_key = getpass.getpass("Platform_AppAuthKey (ClientApiKey): ")
    password = getpass.getpass("Platform_Password: ")
    if not app_auth_key or not password:
        sys.exit("Both values are required.")

    print(
        "UPDATE interfaceconfiguration\n"
        f"SET Platform_AppAuthKey = '{encrypt_secret(app_auth_key)}',\n"
        f"    Platform_Password   = '{encrypt_secret(password)}'\n"
        f"WHERE InterfaceId = {args.interface_id};"
    )


if __name__ == "__main__":
    main()
