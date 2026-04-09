"""
Tests for targets/manager.py — connection target CRUD.
"""
import sys, os, tempfile, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from targets.manager import TargetManager
from targets.crypto import is_encrypted


class TestTargetsManager:
    def setup_method(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w")
        self.tmp.write("[]")
        self.tmp.close()

        self.m = TargetManager()
        self.m._file = self.tmp.name

    def teardown_method(self):
        os.unlink(self.tmp.name)

    def test_add_target_returns_target(self):
        t = self.m.add("My Server", "ssh", {"host": "1.2.3.4"})
        assert t["name"] == "My Server"
        assert t["type"] == "ssh"
        assert "id" in t

    def test_load_targets_returns_added(self):
        self.m.add("Server A", "ssh", {})
        targets = self.m.load()
        assert len(targets) == 1
        assert targets[0]["name"] == "Server A"

    def test_get_target_by_id(self):
        t = self.m.add("K8s", "kubernetes", {"context": "prod"})
        found = self.m.get(t["id"])
        assert found["name"] == "K8s"

    def test_get_target_not_found(self):
        assert self.m.get("nonexistent") is None

    def test_remove_target(self):
        t = self.m.add("ToRemove", "docker", {})
        self.m.remove(t["id"])
        assert self.m.get(t["id"]) is None

    def test_update_status(self):
        t = self.m.add("AWS", "aws", {})
        self.m.update_status(t["id"], "online")
        found = self.m.get(t["id"])
        assert found["status"] == "online"

    def test_has_local_target_false(self):
        self.m.add("SSH Server", "ssh", {})
        assert self.m.has_local() is False

    def test_has_local_target_true(self):
        self.m.add("This Machine", "local", {})
        assert self.m.has_local() is True

    def test_multiple_targets(self):
        self.m.add("A", "ssh", {})
        self.m.add("B", "kubernetes", {})
        self.m.add("C", "docker", {})
        assert len(self.m.load()) == 3

    def test_target_has_unknown_status_by_default(self):
        t = self.m.add("Server", "ssh", {})
        assert t["status"] == "unknown"

    # ── encryption tests ─────────────────────────────────────────────────────

    def test_sensitive_values_encrypted_on_disk(self):
        """Passwords and tokens must be encrypted in the JSON file."""
        self.m.add("Secure SSH", "ssh", {
            "host": "10.0.0.1",
            "password": "s3cr3t!",
            "key_passphrase": "my_pass",
        })
        # Read raw JSON from disk — sensitive values should be encrypted
        with open(self.tmp.name) as f:
            raw = json.load(f)
        config = raw[0]["config"]
        assert is_encrypted(config["password"]), "password should be encrypted on disk"
        assert is_encrypted(config["key_passphrase"]), "key_passphrase should be encrypted on disk"
        assert config["host"] == "10.0.0.1", "non-sensitive values should be plaintext"

    def test_get_returns_decrypted_values(self):
        """Internal get() must return decrypted plaintext for tool execution."""
        t = self.m.add("SSH", "ssh", {"host": "x", "password": "hunter2"})
        found = self.m.get(t["id"])
        assert found["config"]["password"] == "hunter2"
        assert found["config"]["host"] == "x"

    def test_load_safe_masks_sensitive_values(self):
        """Frontend-facing load_safe() must return '***' for secrets."""
        self.m.add("AWS", "aws", {
            "region": "us-east-1",
            "secret_access_key": "wJalrXUtnFEMI/K7MDENG",
            "access_key_id": "AKIAIOSFODNN7EXAMPLE",
        })
        safe = self.m.load_safe()
        config = safe[0]["config"]
        assert config["secret_access_key"] == "***"
        assert config["access_key_id"] == "***"
        assert config["region"] == "us-east-1"

    def test_migrate_plaintext_encrypts_existing(self):
        """migrate_plaintext() should encrypt any pre-existing plaintext secrets."""
        # Write plaintext secret directly to disk (simulating old format)
        with open(self.tmp.name, "w") as f:
            json.dump([{
                "id": "test-1", "name": "Old", "type": "ssh",
                "config": {"host": "x", "password": "old_pass"},
                "status": "unknown",
            }], f)
        self.m.migrate_plaintext()
        # Verify disk is now encrypted
        with open(self.tmp.name) as f:
            raw = json.load(f)
        assert is_encrypted(raw[0]["config"]["password"])
        # Verify we can still read it
        found = self.m.get("test-1")
        assert found["config"]["password"] == "old_pass"
