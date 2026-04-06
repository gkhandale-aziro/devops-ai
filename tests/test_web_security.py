"""
Tests for web API security — auth middleware, rate limiting, secret masking.
"""
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


class TestAuthMiddleware:
    """API key authentication via Bearer token."""

    def setup_method(self):
        os.environ["AZIRO_API_KEY"] = "test-secret-key-12345"
        # Force reimport to pick up env var
        import importlib
        import ui.web as web_mod
        importlib.reload(web_mod)
        self.app = web_mod.app
        self.client = self.app.test_client()

    def teardown_method(self):
        os.environ.pop("AZIRO_API_KEY", None)

    def test_api_rejects_missing_auth(self):
        r = self.client.get("/api/v1/info")
        assert r.status_code == 401
        assert b"Missing Authorization" in r.data

    def test_api_rejects_wrong_key(self):
        r = self.client.get("/api/v1/info",
                            headers={"Authorization": "Bearer wrong-key"})
        assert r.status_code == 401
        assert b"Invalid API key" in r.data

    def test_api_accepts_correct_key(self):
        r = self.client.get("/api/v1/info",
                            headers={"Authorization": "Bearer test-secret-key-12345"})
        assert r.status_code == 200

    def test_static_routes_bypass_auth(self):
        """Non-API routes (frontend) should not require auth."""
        r = self.client.get("/")
        # May 404 if frontend_dist missing, but should NOT be 401
        assert r.status_code != 401


class TestSecurityHeaders:
    """Verify hardening headers are present."""

    def setup_method(self):
        os.environ.pop("AZIRO_API_KEY", None)
        import importlib
        import ui.web as web_mod
        importlib.reload(web_mod)
        self.client = web_mod.app.test_client()

    def test_security_headers_present(self):
        r = self.client.get("/api/v1/info")
        assert r.headers.get("X-Content-Type-Options") == "nosniff"
        assert r.headers.get("X-Frame-Options") == "DENY"
        assert r.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"

    def test_json_no_store(self):
        r = self.client.get("/api/v1/info")
        assert "no-store" in r.headers.get("Cache-Control", "")


class TestSecretMasking:
    """Ensure no secrets leak through API responses."""

    def setup_method(self):
        os.environ.pop("AZIRO_API_KEY", None)
        import importlib
        import ui.web as web_mod
        importlib.reload(web_mod)
        self.app = web_mod.app
        self.client = self.app.test_client()

    def test_add_target_returns_masked_config(self):
        """POST /api/v1/targets must NOT return plaintext passwords."""
        r = self.client.post("/api/v1/targets",
                             json={"name": "test", "type": "ssh",
                                   "config": {"host": "x", "password": "s3cret"}},
                             content_type="application/json")
        assert r.status_code == 200
        data = r.get_json()
        assert data["config"]["password"] == "***", "Password leaked to frontend!"
        assert data["config"]["host"] == "x"
        # Cleanup
        self.client.delete(f"/api/v1/targets/{data['id']}")

    def test_list_targets_returns_masked_config(self):
        """GET /api/v1/targets must mask all sensitive values."""
        r = self.client.post("/api/v1/targets",
                             json={"name": "aws-test", "type": "aws",
                                   "config": {"region": "us-east-1", "secret_access_key": "WJALR"}},
                             content_type="application/json")
        tid = r.get_json()["id"]
        r = self.client.get("/api/v1/targets")
        targets = r.get_json()
        for t in targets:
            for k, v in t.get("config", {}).items():
                if k in ("password", "secret_access_key", "access_key_id",
                         "token", "session_token", "key_passphrase"):
                    assert v == "***", f"{k} leaked: {v}"
        # Cleanup
        self.client.delete(f"/api/v1/targets/{tid}")


class TestIDORProtection:
    """Verify 404 for non-existent resources (IDOR prevention)."""

    def setup_method(self):
        os.environ.pop("AZIRO_API_KEY", None)
        import importlib
        import ui.web as web_mod
        importlib.reload(web_mod)
        self.client = web_mod.app.test_client()

    def test_delete_nonexistent_target_returns_404(self):
        r = self.client.delete("/api/v1/targets/does-not-exist-999")
        assert r.status_code == 404

    def test_delete_nonexistent_session_returns_404(self):
        r = self.client.delete("/api/v1/sessions/does-not-exist-999")
        assert r.status_code == 404

    def test_get_messages_nonexistent_session_returns_404(self):
        r = self.client.get("/api/v1/sessions/does-not-exist-999/messages")
        assert r.status_code == 404

    def test_patch_nonexistent_event_returns_404(self):
        r = self.client.patch("/api/v1/events/999999",
                              json={"status": "acknowledged"},
                              content_type="application/json")
        assert r.status_code == 404

    def test_events_rejects_invalid_level(self):
        r = self.client.get("/api/v1/events?level=INVALID")
        assert r.status_code == 400

    def test_events_clamps_limit(self):
        """Huge limit param should be clamped, not cause error."""
        r = self.client.get("/api/v1/events?limit=99999")
        assert r.status_code == 200


class TestCommandInjectionPrevention:
    """Verify shell injection via search and logs is blocked."""

    def setup_method(self):
        os.environ.pop("AZIRO_API_KEY", None)
        import importlib
        import ui.web as web_mod
        importlib.reload(web_mod)
        self.client = web_mod.app.test_client()
        # Add a temporary kubernetes target for search tests
        r = self.client.post("/api/v1/targets",
                             json={"name": "k8s-injection-test", "type": "kubernetes",
                                   "config": {"context": "test"}},
                             content_type="application/json")
        self.tid = r.get_json()["id"]
        # Add an SSH target for journalctl tests
        r = self.client.post("/api/v1/targets",
                             json={"name": "ssh-injection-test", "type": "ssh",
                                   "config": {"host": "127.0.0.1", "user": "test"}},
                             content_type="application/json")
        self.ssh_tid = r.get_json()["id"]

    def teardown_method(self):
        self.client.delete(f"/api/v1/targets/{self.tid}")
        self.client.delete(f"/api/v1/targets/{self.ssh_tid}")

    def test_search_rejects_shell_metacharacters(self):
        """Search query with shell metacharacters should be rejected."""
        r = self.client.get(f"/api/v1/search/{self.tid}?q=;rm+-rf+/")
        assert r.status_code == 400

    def test_search_rejects_pipe(self):
        r = self.client.get(f"/api/v1/search/{self.tid}?q=test|cat+/etc/passwd")
        assert r.status_code == 400

    def test_search_rejects_backtick(self):
        r = self.client.get(f"/api/v1/search/{self.tid}?q=`whoami`")
        assert r.status_code == 400

    def test_search_rejects_dollar_subshell(self):
        r = self.client.get(f"/api/v1/search/{self.tid}?q=$(whoami)")
        assert r.status_code == 400

    def test_search_allows_safe_query(self):
        """Normal alphanumeric queries should succeed (may return empty)."""
        r = self.client.get(f"/api/v1/search/{self.tid}?q=nginx")
        assert r.status_code == 200

    def test_logs_rejects_malicious_unit(self):
        """Unit name with shell metacharacters should be rejected."""
        r = self.client.get(f"/api/v1/tab/{self.ssh_tid}/logs?unit=;rm+-rf+/")
        assert r.status_code == 400

    def test_logs_rejects_unit_with_spaces(self):
        r = self.client.get(f"/api/v1/tab/{self.ssh_tid}/logs?unit=test unit")
        assert r.status_code == 400

    def test_logs_allows_safe_unit(self):
        """Valid systemd unit names should pass validation."""
        # We don't assert 200 since the SSH target isn't real,
        # but we verify it doesn't return 400 (validation passes)
        r = self.client.get(f"/api/v1/tab/{self.ssh_tid}/logs?unit=nginx.service")
        assert r.status_code != 400
