"""
targets/manager.py — manage saved targets (servers, clusters, cloud accounts).
Persisted to targets.json so they survive restarts.

Security:
  - Sensitive config values (passwords, keys, tokens) are encrypted at rest
    using Fernet symmetric encryption (targets/crypto.py).
  - The load_safe() method masks sensitive values for frontend display.
  - The get() method returns fully decrypted config for internal use only.
"""
import json
import uuid
import os

from targets.crypto import encrypt, decrypt, is_encrypted

_SENSITIVE_KEYS = {
    "password", "private_key", "secret_key", "secret_access_key",
    "api_key", "token", "auth_token", "access_token", "client_secret",
    "service_account_key", "credentials", "key_passphrase",
    "access_key_id", "session_token",
}


class TargetManager:
    """
    Manages targets — add, remove, get, update status.
    Mirrors kubectl-ai's target/config loading pattern.
    """

    def __init__(self):
        self._file = os.path.join(os.path.dirname(__file__), "..", "targets.json")

    # ── persistence ──────────────────────────────────────────────────────────

    def load(self):
        """Load targets from disk and decrypt sensitive config values."""
        if not os.path.exists(self._file):
            return []
        with open(self._file) as f:
            targets = json.load(f)
        # Decrypt in memory — disk stays encrypted
        for t in targets:
            t["config"] = self._decrypt_config(t.get("config", {}))
        return targets

    def _save(self, targets):
        """Save targets with sensitive values encrypted."""
        encrypted = []
        for t in targets:
            copy = {**t, "config": self._encrypt_config(t.get("config", {}))}
            encrypted.append(copy)
        with open(self._file, "w") as f:
            json.dump(encrypted, f, indent=2)

    # ── encryption helpers ───────────────────────────────────────────────────

    @staticmethod
    def _encrypt_config(config: dict) -> dict:
        """Encrypt sensitive values in a config dict for persistence."""
        result = {}
        for k, v in config.items():
            if k.lower() in _SENSITIVE_KEYS and isinstance(v, str) and v and not is_encrypted(v):
                result[k] = encrypt(v)
            else:
                result[k] = v
        return result

    @staticmethod
    def _decrypt_config(config: dict) -> dict:
        """Decrypt sensitive values in a config dict loaded from disk."""
        result = {}
        for k, v in config.items():
            if k.lower() in _SENSITIVE_KEYS and isinstance(v, str) and is_encrypted(v):
                result[k] = decrypt(v)
            else:
                result[k] = v
        return result

    # ── target operations ────────────────────────────────────────────────────

    def add(self, name, target_type, config):
        targets = self.load()
        target  = {
            "id":     str(uuid.uuid4()),
            "name":   name,
            "type":   target_type,
            "config": config,
            "status": "unknown",
        }
        targets.append(target)
        self._save(targets)
        return target

    def remove(self, target_id):
        targets = [t for t in self.load() if t["id"] != target_id]
        self._save(targets)

    def get(self, target_id):
        for t in self.load():
            if t["id"] == target_id:
                return t
        return None

    def update_status(self, target_id, status):
        targets = self.load()
        for t in targets:
            if t["id"] == target_id:
                t["status"] = status
        self._save(targets)

    def has_local(self):
        return any(t.get("type") == "local" for t in self.load())

    @staticmethod
    def mask_config(config: dict) -> dict:
        """Return config with sensitive values replaced by '***'."""
        return {
            k: ("***" if k.lower() in _SENSITIVE_KEYS else v)
            for k, v in config.items()
        }

    def load_safe(self):
        """Return targets list with sensitive config fields masked."""
        targets = self.load()
        return [
            {**t, "config": self.mask_config(t.get("config", {}))}
            for t in targets
        ]

    def migrate_plaintext(self):
        """One-time migration: re-save existing targets to encrypt any plaintext secrets."""
        if not os.path.exists(self._file):
            return
        with open(self._file) as f:
            targets = json.load(f)
        # Check if any sensitive value is still plaintext
        needs_migration = False
        for t in targets:
            for k, v in t.get("config", {}).items():
                if k.lower() in _SENSITIVE_KEYS and isinstance(v, str) and v and not is_encrypted(v):
                    needs_migration = True
                    break
        if needs_migration:
            # load() decrypts already-encrypted values; _save() encrypts everything
            self._save(self.load())
