"""
targets/crypto.py — Fernet symmetric encryption for credentials at rest.

Key management:
  - On first run, a random 256-bit key is generated and stored in .aziro_key
  - The key file is chmod 600 (owner only) where supported
  - Override location via AZIRO_KEY_FILE env var
"""
import os
import stat
import base64
from cryptography.fernet import Fernet, InvalidToken

_KEY_FILE = os.environ.get(
    "AZIRO_KEY_FILE",
    os.path.join(os.path.dirname(__file__), "..", ".aziro_key"),
)


def _ensure_key() -> bytes:
    """Load or generate the Fernet key. Returns raw 32-byte URL-safe-b64 key."""
    path = os.path.abspath(_KEY_FILE)
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read().strip()

    key = Fernet.generate_key()
    with open(path, "wb") as f:
        f.write(key)

    # Restrict file permissions (owner read/write only)
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass  # Windows may not support POSIX permissions fully
    return key


def _fernet() -> Fernet:
    return Fernet(_ensure_key())


def encrypt(plaintext: str) -> str:
    """Encrypt a plaintext string. Returns base64-encoded ciphertext prefixed with 'enc:'."""
    if not plaintext:
        return plaintext
    token = _fernet().encrypt(plaintext.encode("utf-8"))
    return "enc:" + token.decode("ascii")


def decrypt(ciphertext: str) -> str:
    """Decrypt a value previously encrypted with encrypt(). Non-encrypted values pass through."""
    if not ciphertext or not ciphertext.startswith("enc:"):
        return ciphertext
    try:
        return _fernet().decrypt(ciphertext[4:].encode("ascii")).decode("utf-8")
    except (InvalidToken, Exception):
        return ciphertext  # corrupted or wrong key — return as-is


def is_encrypted(value: str) -> bool:
    """Check if value is already encrypted."""
    return isinstance(value, str) and value.startswith("enc:")
