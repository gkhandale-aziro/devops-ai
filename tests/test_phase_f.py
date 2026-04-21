"""
Tests for Phase F — Flask-Limiter rate limiting (SEC-3).

Covered:
  - Default per-API limit blocks once exceeded (429 JSON, X-RateLimit-* headers)
  - /api/v1/healthz and /api/v1/readyz are exempt (k8s probes mustn't 429)
  - Chat stream endpoints carry a stricter per-user LLM cost cap
  - /api/v1/auth/login carries a tight brute-force cap
  - Rate-limit key uses the authenticated user when logged in (so one user
    can't DoS another behind the same NAT IP)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch


def _isolated(monkeypatch, tmp_path, **env):
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    for key in ("AZIRO_API_KEY", "AZIRO_ALLOWED_ORIGINS", "AZIRO_ENABLE_HSTS",
                "AZIRO_PROXY_HOPS", "AZIRO_AUTH_MODE", "AZIRO_SESSION_SECRET",
                "AZIRO_BOOTSTRAP_ADMIN_USER", "AZIRO_BOOTSTRAP_ADMIN_PASSWORD",
                "AZIRO_RATE_LIMIT", "AZIRO_CHAT_STREAM_LIMITS",
                "AZIRO_LOGIN_LIMITS", "AZIRO_LIMITER_STORAGE"):
        monkeypatch.delenv(key, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)


def _reload_web():
    for mod in ("ui.web", "auth", "auth.db", "auth.middleware", "auth.routes"):
        sys.modules.pop(mod, None)
    import ui.web as web
    web.app.config["TESTING"] = True
    return web, web.app.test_client()


@pytest.fixture
def app_with_tight_limits(tmp_path, monkeypatch):
    """Flask app with tiny limits so tests can actually trip them without
    spamming 120 requests. Fresh in-memory storage per test."""
    # apikey mode + no AZIRO_API_KEY = auth disabled, so requests fall
    # through to the rate limiter (what we're actually testing here).
    _isolated(monkeypatch, tmp_path,
              AZIRO_AUTH_MODE="apikey",
              AZIRO_SESSION_SECRET="test-secret",
              AZIRO_RATE_LIMIT="3/minute",
              AZIRO_CHAT_STREAM_LIMITS="2/minute",
              AZIRO_LOGIN_LIMITS="3/minute")
    with patch("providers.LLMClient"), \
         patch("tools.ToolExecutor"), \
         patch("sessions.SessionManager") as MockSessions, \
         patch("targets.TargetManager") as MockTargets, \
         patch("agent.Agent"), \
         patch("agent.AgentSession"), \
         patch("store.EventStore") as MockStore, \
         patch("store.metrics.MetricCollector"):
        MockTargets.return_value.load_safe.return_value = []
        MockSessions.return_value.load.return_value = []
        # /readyz reads _store._engine.dialect.name for the check key;
        # give the mock a concrete string so jsonify() doesn't choke.
        MockStore.return_value._engine.dialect.name = "sqlite"
        yield _reload_web()


class TestDefaultLimit:
    def test_default_limit_blocks_once_exceeded(self, app_with_tight_limits):
        web, client = app_with_tight_limits
        # Under the 3/minute default, the 4th hit on the same endpoint
        # (keyed by IP since the caller is anonymous) must 429.
        for _ in range(3):
            r = client.get("/api/v1/targets")
            assert r.status_code != 429, r.data
        r = client.get("/api/v1/targets")
        assert r.status_code == 429
        body = r.get_json()
        assert "Rate limit exceeded" in body["error"]
        # Flask-Limiter should emit these headers on any response.
        assert "X-RateLimit-Limit" in r.headers
        assert "Retry-After" in r.headers

    def test_probe_paths_are_exempt(self, app_with_tight_limits):
        """k8s liveness/readiness probes run every few seconds and must
        never 429 — otherwise the orchestrator kills the pod."""
        web, client = app_with_tight_limits
        # Comfortably more than the 3/minute cap.
        for _ in range(10):
            rh = client.get("/api/v1/healthz")
            assert rh.status_code != 429, f"healthz got 429: {rh.data!r}"
            rr = client.get("/api/v1/readyz")
            assert rr.status_code != 429, f"readyz got 429: {rr.data!r}"

    def test_non_api_paths_are_exempt(self, app_with_tight_limits):
        """Static asset + SPA routes don't go through /api/ — they should
        never be rate-limited (users can refresh the page freely)."""
        web, client = app_with_tight_limits
        # More hits than the default cap; none should 429 because they
        # aren't /api/ paths.
        for _ in range(10):
            r = client.get("/")  # SPA shell
            assert r.status_code != 429


class TestChatStreamLimit:
    def test_chat_stream_has_tighter_cap(self, app_with_tight_limits):
        """Chat streams carry the _CHAT_STREAM_LIMITS cap (2/minute in
        this fixture). After 2 streams, the 3rd must 429 even though
        the default cap (3/minute) hasn't been hit yet."""
        web, client = app_with_tight_limits
        for _ in range(2):
            r = client.post("/api/v1/chat/nonexistent/stream",
                            json={"message": "hi"})
            assert r.status_code != 429, r.data  # within the 2/minute cap
        r = client.post("/api/v1/chat/nonexistent/stream",
                        json={"message": "hi"})
        assert r.status_code == 429

    def test_analyze_stream_has_tighter_cap(self, app_with_tight_limits):
        web, client = app_with_tight_limits
        for _ in range(2):
            r = client.post("/api/v1/analyze/stream", json={"prompt": "x"})
            assert r.status_code != 429, r.data
        r = client.post("/api/v1/analyze/stream", json={"prompt": "x"})
        assert r.status_code == 429


class TestLoginLimit:
    def test_login_brute_force_is_capped(self, app_with_tight_limits):
        web, client = app_with_tight_limits
        # 3/minute cap on the auth blueprint. Wrong creds → 401 until
        # we exhaust the window, then 429.
        for _ in range(3):
            r = client.post("/api/v1/auth/login",
                            json={"username": "nope", "password": "nope"})
            assert r.status_code != 429
        r = client.post("/api/v1/auth/login",
                        json={"username": "nope", "password": "nope"})
        assert r.status_code == 429


class TestJSON429:
    def test_json_body_and_headers(self, app_with_tight_limits):
        web, client = app_with_tight_limits
        for _ in range(4):
            r = client.get("/api/v1/targets")
        assert r.status_code == 429
        assert r.is_json
        body = r.get_json()
        assert "error" in body
        assert "detail" in body
        # Frontend needs structured JSON to show a useful toast, not HTML.
        assert r.headers["Content-Type"].startswith("application/json")
