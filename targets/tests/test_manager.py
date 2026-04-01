"""
Tests for targets/manager.py — connection target CRUD.
"""
import sys, os, tempfile, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


class TestTargetsManager:
    def setup_method(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w")
        self.tmp.write("[]")
        self.tmp.close()

        import targets.manager as m
        m.TARGETS_FILE = self.tmp.name
        self.m = m

    def teardown_method(self):
        os.unlink(self.tmp.name)

    def test_add_target_returns_target(self):
        t = self.m.add_target("My Server", "ssh", {"host": "1.2.3.4"})
        assert t["name"] == "My Server"
        assert t["type"] == "ssh"
        assert "id" in t

    def test_load_targets_returns_added(self):
        self.m.add_target("Server A", "ssh", {})
        targets = self.m.load_targets()
        assert len(targets) == 1
        assert targets[0]["name"] == "Server A"

    def test_get_target_by_id(self):
        t = self.m.add_target("K8s", "kubernetes", {"context": "prod"})
        found = self.m.get_target(t["id"])
        assert found["name"] == "K8s"

    def test_get_target_not_found(self):
        assert self.m.get_target("nonexistent") is None

    def test_remove_target(self):
        t = self.m.add_target("ToRemove", "docker", {})
        self.m.remove_target(t["id"])
        assert self.m.get_target(t["id"]) is None

    def test_update_status(self):
        t = self.m.add_target("AWS", "aws", {})
        self.m.update_status(t["id"], "online")
        found = self.m.get_target(t["id"])
        assert found["status"] == "online"

    def test_has_local_target_false(self):
        self.m.add_target("SSH Server", "ssh", {})
        assert self.m.has_local_target() is False

    def test_has_local_target_true(self):
        self.m.add_target("This Machine", "local", {})
        assert self.m.has_local_target() is True

    def test_multiple_targets(self):
        self.m.add_target("A", "ssh", {})
        self.m.add_target("B", "kubernetes", {})
        self.m.add_target("C", "docker", {})
        assert len(self.m.load_targets()) == 3

    def test_target_has_unknown_status_by_default(self):
        t = self.m.add_target("Server", "ssh", {})
        assert t["status"] == "unknown"
