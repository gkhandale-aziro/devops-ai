"""
Tests for Phase E1 — backend auth baseline.

H-01 / SEC-1 / SEC-2
  - users table + bcrypt password hashing + role model (admin, viewer)
  - Flask-Login session cookies via POST /api/v1/auth/login
  - AZIRO_AUTH_MODE=apikey|session|both switches the gate
  - Audit log records every state-changing /api/ request
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch


# ── helpers ──────────────────────────────────────────────────────────────────

def _isolated_data_dir(monkeypatch, tmp_path):
    """Point every module that writes to a data dir at `tmp_path` and clear
    env overrides so tests are deterministic."""
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    for key in ("AZIRO_API_KEY", "AZIRO_ALLOWED_ORIGINS", "AZIRO_ENABLE_HSTS",
                "AZIRO_PROXY_HOPS", "AZIRO_AUTH_MODE", "AZIRO_SESSION_SECRET",
                "AZIRO_BOOTSTRAP_ADMIN_USER", "AZIRO_BOOTSTRAP_ADMIN_PASSWORD"):
        monkeypatch.delenv(key, raising=False)


def _reload_web():
    sys.modules.pop("ui.web", None)
    sys.modules.pop("auth", None)
    sys.modules.pop("auth.db", None)
    sys.modules.pop("auth.middleware", None)
    sys.modules.pop("auth.routes", None)
    import ui.web as web
    web.app.config["TESTING"] = True
    return web, web.app.test_client()


@pytest.fixture
def fresh(tmp_path, monkeypatch):
    _isolated_data_dir(monkeypatch, tmp_path)
    # Session-mode gate so login becomes the only way in.
    monkeypatch.setenv("AZIRO_AUTH_MODE", "session")
    monkeypatch.setenv("AZIRO_SESSION_SECRET", "test-secret-please-ignore")
    with patch("providers.LLMClient"), \
         patch("tools.ToolExecutor"), \
         patch("sessions.SessionManager") as MockSessions, \
         patch("targets.TargetManager") as MockTargets, \
         patch("agent.Agent"), \
         patch("agent.AgentSession"), \
         patch("store.EventStore"), \
         patch("store.metrics.MetricCollector"):
        MockTargets.return_value.has_local.return_value = True
        MockTargets.return_value.add.return_value = {
            "id": "t1", "name": "x", "type": "kubernetes",
            "config": {}, "status": "unknown",
        }
        MockTargets.return_value.mask_config.return_value = {}
        MockTargets.return_value.load_safe.return_value = []
        MockSessions.return_value.load.return_value = []
        yield _reload_web()


# ── AuthStore primitives ─────────────────────────────────────────────────────

class TestAuthStore:
    def test_create_user_and_verify_password(self, tmp_path, monkeypatch):
        _isolated_data_dir(monkeypatch, tmp_path)
        monkeypatch.setenv("AZIRO_BCRYPT_ROUNDS", "4")  # speed tests up
        sys.modules.pop("auth.db", None)
        from auth.db import AuthStore
        s = AuthStore()
        created = s.create_user("alice", "correct-horse-battery", role="admin")
        assert created["username"] == "alice"
        assert created["role"]     == "admin"

        ok = s.verify_password("alice", "correct-horse-battery")
        assert ok is not None and ok["role"] == "admin"

        assert s.verify_password("alice", "wrong") is None

    def test_create_rejects_weak_password(self, tmp_path, monkeypatch):
        _isolated_data_dir(monkeypatch, tmp_path)
        sys.modules.pop("auth.db", None)
        from auth.db import AuthStore
        s = AuthStore()
        with pytest.raises(ValueError):
            s.create_user("alice", "short", role="admin")

    def test_create_rejects_bad_role(self, tmp_path, monkeypatch):
        _isolated_data_dir(monkeypatch, tmp_path)
        sys.modules.pop("auth.db", None)
        from auth.db import AuthStore
        s = AuthStore()
        with pytest.raises(ValueError):
            s.create_user("alice", "correct-horse-battery", role="superuser")

    def test_duplicate_username_rejected(self, tmp_path, monkeypatch):
        _isolated_data_dir(monkeypatch, tmp_path)
        monkeypatch.setenv("AZIRO_BCRYPT_ROUNDS", "4")
        sys.modules.pop("auth.db", None)
        from auth.db import AuthStore
        s = AuthStore()
        s.create_user("alice", "correct-horse-battery", role="admin")
        with pytest.raises(ValueError):
            s.create_user("alice", "correct-horse-battery", role="viewer")

    def test_lockout_triggers_after_n_failures(self, tmp_path, monkeypatch):
        _isolated_data_dir(monkeypatch, tmp_path)
        monkeypatch.setenv("AZIRO_LOGIN_FAIL_LIMIT", "3")
        monkeypatch.setenv("AZIRO_LOGIN_FAIL_WINDOW", "300")
        monkeypatch.setenv("AZIRO_LOGIN_FAIL_LOCKOUT", "300")
        sys.modules.pop("auth.db", None)
        from auth.db import AuthStore
        s = AuthStore()
        assert not s.is_locked_out("alice")
        for _ in range(3):
            s.record_login_failure("alice")
        assert s.is_locked_out("alice")
        s.clear_login_failures("alice")
        assert not s.is_locked_out("alice")


# ── login / logout / me ──────────────────────────────────────────────────────

class TestLoginFlow:
    def test_me_401_when_anonymous(self, fresh):
        _, c = fresh
        r = c.get("/api/v1/auth/me")
        assert r.status_code == 401

    def test_login_success_sets_session(self, fresh, monkeypatch):
        web, c = fresh
        # Seed a user via the store directly.
        web._auth.create_user("alice", "correct-horse-battery", role="admin")

        r = c.post("/api/v1/auth/login",
                   json={"username": "alice", "password": "correct-horse-battery"})
        assert r.status_code == 200
        assert r.get_json()["user"]["role"] == "admin"

        me = c.get("/api/v1/auth/me")
        assert me.status_code == 200
        assert me.get_json()["username"] == "alice"

    def test_login_wrong_password_records_failure(self, fresh):
        web, c = fresh
        web._auth.create_user("alice", "correct-horse-battery", role="admin")
        r = c.post("/api/v1/auth/login",
                   json={"username": "alice", "password": "nope"})
        assert r.status_code == 401
        assert web._auth.is_locked_out("alice") is False  # one failure < limit

    def test_login_validates_payload_types(self, fresh):
        _, c = fresh
        r = c.post("/api/v1/auth/login", json={"username": 1, "password": 2})
        assert r.status_code == 400

    def test_logout_requires_session(self, fresh):
        _, c = fresh
        r = c.post("/api/v1/auth/logout")
        assert r.status_code == 401


# ── AUTH_MODE switch ─────────────────────────────────────────────────────────

class TestAuthModeMatrix:
    def test_apikey_mode_allows_bearer(self, tmp_path, monkeypatch):
        _isolated_data_dir(monkeypatch, tmp_path)
        monkeypatch.setenv("AZIRO_AUTH_MODE", "apikey")
        monkeypatch.setenv("AZIRO_API_KEY", "secret123")
        with patch("providers.LLMClient"), \
             patch("tools.ToolExecutor"), \
             patch("sessions.SessionManager") as MS, \
             patch("targets.TargetManager") as MT, \
             patch("agent.Agent"), \
             patch("agent.AgentSession"), \
             patch("store.EventStore"), \
             patch("store.metrics.MetricCollector"):
            MT.return_value.has_local.return_value = True
            MT.return_value.load_safe.return_value = []
            MS.return_value.load.return_value = []
            _, c = _reload_web()
            # No Authorization → 401
            r = c.get("/api/v1/targets")
            assert r.status_code == 401
            # With valid Bearer → handler returns 200 since
            # TargetManager.load_safe is mocked to [].
            r = c.get("/api/v1/targets",
                      headers={"Authorization": "Bearer secret123"})
            assert r.status_code == 200

    def test_session_mode_rejects_bearer(self, fresh):
        """Session mode means Bearer is NOT enough — must have a session."""
        _, c = fresh
        r = c.get("/api/v1/info",
                  headers={"Authorization": "Bearer anything"})
        assert r.status_code == 401

    def test_probe_paths_open_in_session_mode(self, fresh):
        _, c = fresh
        r = c.get("/api/v1/healthz")
        assert r.status_code == 200


# ── auth mode inference (foot-gun fix) ───────────────────────────────────────

class TestAuthModeInference:
    """get_auth_mode() must infer the right mode from whichever credentials
    the operator actually provided, so setting AZIRO_SESSION_SECRET without
    also remembering AZIRO_AUTH_MODE doesn't silently stay in apikey mode."""

    def _reload_and_call(self, monkeypatch, **env):
        for k in ("AZIRO_AUTH_MODE", "AZIRO_API_KEY", "AZIRO_SESSION_SECRET"):
            monkeypatch.delenv(k, raising=False)
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        sys.modules.pop("auth.middleware", None)
        from auth.middleware import get_auth_mode
        return get_auth_mode()

    def test_neither_defaults_to_apikey(self, monkeypatch):
        assert self._reload_and_call(monkeypatch) == "apikey"

    def test_session_secret_alone_picks_session(self, monkeypatch):
        assert self._reload_and_call(monkeypatch,
                                     AZIRO_SESSION_SECRET="x") == "session"

    def test_api_key_alone_picks_apikey(self, monkeypatch):
        assert self._reload_and_call(monkeypatch,
                                     AZIRO_API_KEY="x") == "apikey"

    def test_both_credentials_picks_both(self, monkeypatch):
        assert self._reload_and_call(monkeypatch,
                                     AZIRO_API_KEY="x",
                                     AZIRO_SESSION_SECRET="y") == "both"

    def test_explicit_mode_overrides_inference(self, monkeypatch):
        """Operator-provided AZIRO_AUTH_MODE always wins, even when the
        credential evidence would suggest a different mode."""
        assert self._reload_and_call(monkeypatch,
                                     AZIRO_AUTH_MODE="apikey",
                                     AZIRO_SESSION_SECRET="y") == "apikey"
        assert self._reload_and_call(monkeypatch,
                                     AZIRO_AUTH_MODE="session",
                                     AZIRO_API_KEY="x") == "session"

    def test_invalid_explicit_mode_falls_back_to_inference(self, monkeypatch):
        """Garbage AZIRO_AUTH_MODE should not break the app — fall through
        to credential-based inference."""
        assert self._reload_and_call(monkeypatch,
                                     AZIRO_AUTH_MODE="nonsense",
                                     AZIRO_SESSION_SECRET="y") == "session"


# ── role enforcement ────────────────────────────────────────────────────────

class TestRoleEnforcement:
    def _login(self, web, c, username, password, role):
        web._auth.create_user(username, password, role=role)
        r = c.post("/api/v1/auth/login",
                   json={"username": username, "password": password})
        assert r.status_code == 200

    def test_viewer_blocked_on_state_change(self, fresh):
        web, c = fresh
        self._login(web, c, "bob", "correct-horse-battery", "viewer")
        r = c.post("/api/v1/targets",
                   headers={"Origin": "http://localhost"},
                   json={"name": "x", "type": "kubernetes", "config": {}})
        assert r.status_code == 403

    def test_admin_allowed_on_state_change(self, fresh):
        web, c = fresh
        self._login(web, c, "alice", "correct-horse-battery", "admin")
        r = c.post("/api/v1/targets",
                   headers={"Origin": "http://localhost"},
                   json={"name": "x", "type": "kubernetes", "config": {}})
        # Handler may 500 in mocked env if deeper wiring asserts, but auth
        # + role checks must both pass — so 401/403 would be a regression.
        assert r.status_code not in (401, 403)

    def test_viewer_can_read(self, fresh):
        web, c = fresh
        self._login(web, c, "bob", "correct-horse-battery", "viewer")
        r = c.get("/api/v1/targets")
        assert r.status_code == 200


# ── audit log ────────────────────────────────────────────────────────────────

class TestAuditLog:
    def test_login_is_audited(self, fresh):
        web, c = fresh
        web._auth.create_user("alice", "correct-horse-battery", role="admin")
        c.post("/api/v1/auth/login",
               json={"username": "alice", "password": "correct-horse-battery"})
        rows = web._auth.recent_audit(limit=10)
        assert any(r["action"] == "POST /api/v1/auth/login" for r in rows)

    def test_get_not_audited(self, fresh):
        web, c = fresh
        before = len(web._auth.recent_audit(limit=100))
        c.get("/api/v1/healthz")
        after = len(web._auth.recent_audit(limit=100))
        assert after == before  # GETs don't produce audit rows


# ── bootstrap admin ──────────────────────────────────────────────────────────

class TestBootstrapAdmin:
    def test_bootstrap_creates_admin_on_empty_table(self, tmp_path, monkeypatch):
        _isolated_data_dir(monkeypatch, tmp_path)
        monkeypatch.setenv("AZIRO_BOOTSTRAP_ADMIN_USER", "root")
        monkeypatch.setenv("AZIRO_BOOTSTRAP_ADMIN_PASSWORD", "correct-horse-battery")
        monkeypatch.setenv("AZIRO_BCRYPT_ROUNDS", "4")
        with patch("providers.LLMClient"), \
             patch("tools.ToolExecutor"), \
             patch("sessions.SessionManager") as MS, \
             patch("targets.TargetManager") as MT, \
             patch("agent.Agent"), \
             patch("agent.AgentSession"), \
             patch("store.EventStore"), \
             patch("store.metrics.MetricCollector"):
            MT.return_value.has_local.return_value = True
            MT.return_value.load_safe.return_value = []
            MS.return_value.load.return_value = []
            web, _ = _reload_web()
            assert web._auth.get_user_by_name("root") is not None
            assert web._auth.get_user_by_name("root")["role"] == "admin"

    def test_bootstrap_skipped_when_users_exist(self, tmp_path, monkeypatch):
        _isolated_data_dir(monkeypatch, tmp_path)
        monkeypatch.setenv("AZIRO_BCRYPT_ROUNDS", "4")
        # Pre-create a user so the bootstrap table-is-empty check fails.
        sys.modules.pop("auth.db", None)
        from auth.db import AuthStore
        AuthStore().create_user("pre-existing", "correct-horse-battery", role="admin")

        monkeypatch.setenv("AZIRO_BOOTSTRAP_ADMIN_USER", "second-admin")
        monkeypatch.setenv("AZIRO_BOOTSTRAP_ADMIN_PASSWORD", "correct-horse-battery")
        with patch("providers.LLMClient"), \
             patch("tools.ToolExecutor"), \
             patch("sessions.SessionManager") as MS, \
             patch("targets.TargetManager") as MT, \
             patch("agent.Agent"), \
             patch("agent.AgentSession"), \
             patch("store.EventStore"), \
             patch("store.metrics.MetricCollector"):
            MT.return_value.has_local.return_value = True
            MT.return_value.load_safe.return_value = []
            MS.return_value.load.return_value = []
            web, _ = _reload_web()
            # Bootstrap skipped — second-admin must NOT exist.
            assert web._auth.get_user_by_name("second-admin") is None
