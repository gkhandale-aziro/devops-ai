"""
targets/manager.py — manage saved targets (servers, clusters, cloud accounts).
Persisted to targets.json so they survive restarts.
"""
import json
import uuid
import os

_SENSITIVE_KEYS = {
    "password", "private_key", "secret_key", "secret_access_key",
    "api_key", "token", "auth_token", "access_token", "client_secret",
    "service_account_key", "credentials",
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
        if not os.path.exists(self._file):
            return []
        with open(self._file) as f:
            return json.load(f)

    def _save(self, targets):
        with open(self._file, "w") as f:
            json.dump(targets, f, indent=2)

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
