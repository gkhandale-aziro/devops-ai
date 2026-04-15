"""
Tests for Phase D — production server + edge hardening.

C-03/RUN-1: gunicorn.conf.py must declare gevent workers + bind to the
            canonical port, otherwise the Dockerfile's CMD ships a broken
            config into prod.
H-03:       HSTS must only emit when (a) AZIRO_ENABLE_HSTS is truthy and
            (b) the request is HTTPS (ProxyFix-aware via X-Forwarded-Proto).
H-08/SEC-4: State-changing cross-origin requests must 403. GET and probe
            paths bypass the check. Same-host requests are always allowed.
"""
import importlib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch


# ── fixture — same source-class patching pattern as phase B/C ────────────────

def _reload_web(monkeypatch, allowed_origins: str = "", hsts: str = "",
                proxy_hops: str = "1"):
    """Re-import ui.web with environment overrides applied via monkeypatch
    so values are automatically restored at test teardown. Most Origin/HSTS
    tests need ProxyFix active to see X-Forwarded-Proto, so proxy_hops
    defaults to "1"."""
    # delenv with raising=False is a no-op if the var wasn't set.
    # AZIRO_API_KEY must be cleared too — on CI/dev machines that export
    # it, the auth middleware would return 401 before our Origin check
    # has a chance to return 403, flipping test expectations.
    for key in ("AZIRO_ALLOWED_ORIGINS", "AZIRO_ENABLE_HSTS",
                "AZIRO_PROXY_HOPS", "AZIRO_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    if allowed_origins:
        monkeypatch.setenv("AZIRO_ALLOWED_ORIGINS", allowed_origins)
    if hsts:
        monkeypatch.setenv("AZIRO_ENABLE_HSTS", hsts)
    monkeypatch.setenv("AZIRO_PROXY_HOPS", proxy_hops)
    sys.modules.pop("ui.web", None)
    import ui.web as web
    web.app.config["TESTING"] = True
    return web.app.test_client(), web.app


@pytest.fixture
def webapp():
    with patch("providers.LLMClient"), \
         patch("tools.ToolExecutor"), \
         patch("sessions.SessionManager") as MockSessions, \
         patch("targets.TargetManager") as MockTargets, \
         patch("agent.Agent"), \
         patch("agent.AgentSession"), \
         patch("store.EventStore") as MockStore, \
         patch("store.metrics.MetricCollector"):
        mt = MockTargets.return_value
        mt.has_local.return_value = True
        # JSON-serializable returns so handlers that pass-through origin
        # middleware can still serialize their response without blowing up
        # on MagicMock values.
        mt.add.return_value = {
            "id": "t1", "name": "x", "type": "kubernetes",
            "config": {}, "status": "unknown",
        }
        mt.mask_config.return_value = {}
        mt.load_safe.return_value = []
        MockSessions.return_value.load.return_value = []
        MockStore.return_value._conn.return_value.execute.return_value.fetchone.return_value = (1,)
        yield {"MockSessions": MockSessions, "MockTargets": MockTargets}


# ── C-03 / RUN-1 gunicorn config ─────────────────────────────────────────────

class TestGunicornConfig:
    def test_config_is_importable(self, monkeypatch):
        # Strip any ambient AZIRO_* gunicorn tuning vars so the defaults
        # asserted below can't be silently overridden by CI/dev env.
        for key in ("AZIRO_HOST", "AZIRO_PORT",
                    "AZIRO_GUNICORN_WORKERS",
                    "AZIRO_GUNICORN_WORKER_CONNECTIONS",
                    "AZIRO_GUNICORN_TIMEOUT",
                    "AZIRO_GUNICORN_LOGLEVEL"):
            monkeypatch.delenv(key, raising=False)
        # Path trick: gunicorn.conf.py at repo root isn't on the package
        # path by default, but importlib from file works.
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "gunicorn_conf",
            os.path.join(os.path.dirname(__file__), "..", "gunicorn.conf.py"),
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        assert mod.worker_class == "gevent"
        assert mod.wsgi_app == "ui.web:app"
        # Port 5000 matches Dockerfile EXPOSE + HEALTHCHECK.
        assert mod.bind.endswith(":5000")
        # Timeout must exceed SSE stream upper bound (chat stream ~30s+).
        assert mod.timeout >= 60


# ── H-03 HSTS ────────────────────────────────────────────────────────────────

class TestHSTS:
    def test_hsts_absent_by_default(self, webapp, monkeypatch):
        c, _ = _reload_web(monkeypatch)
        r = c.get("/api/v1/healthz")
        assert "Strict-Transport-Security" not in r.headers

    def test_hsts_absent_over_http_even_when_enabled(self, webapp, monkeypatch):
        c, _ = _reload_web(monkeypatch, hsts="1")
        # Flask test client defaults to http scheme — no X-Forwarded-Proto.
        r = c.get("/api/v1/healthz")
        assert "Strict-Transport-Security" not in r.headers

    def test_hsts_present_when_enabled_and_https(self, webapp, monkeypatch):
        c, _ = _reload_web(monkeypatch, hsts="1")
        # ProxyFix reads X-Forwarded-Proto; setting it makes request.is_secure
        # return True, which is the HSTS gate.
        r = c.get("/api/v1/healthz",
                  headers={"X-Forwarded-Proto": "https"})
        assert r.headers.get("Strict-Transport-Security") == \
               "max-age=31536000; includeSubDomains"


# ── ProxyFix wiring ──────────────────────────────────────────────────────────

class TestProxyFix:
    def test_x_forwarded_proto_honored(self, webapp, monkeypatch):
        c, _ = _reload_web(monkeypatch)
        # Without the header, request.is_secure is False.
        r = c.get("/api/v1/healthz")
        assert r.status_code == 200
        # With X-Forwarded-Proto=https and ProxyFix, the app sees it as HTTPS —
        # we can't read request.is_secure from outside, but the HSTS gate
        # test above exercises it end-to-end.


# ── H-08 Origin / Referer CSRF check ─────────────────────────────────────────

class TestOriginCheck:
    def test_get_bypasses_origin_check(self, webapp, monkeypatch):
        c, _ = _reload_web(monkeypatch)
        # GET has no Origin — must pass regardless.
        r = c.get("/api/v1/healthz")
        assert r.status_code == 200

    def test_probe_path_bypasses(self, webapp, monkeypatch):
        """healthz/readyz are GETs anyway, but if some orchestrator sent
        a POST to healthz it still must not 403."""
        c, _ = _reload_web(monkeypatch)
        # Simulate a same-host POST to a probe (doesn't route, but Origin
        # check runs before routing).
        r = c.post("/api/v1/healthz",
                   headers={"Origin": "https://evil.example"})
        # Either 405 (method not allowed) or 200-ish — must NOT be 403.
        assert r.status_code != 403

    def test_post_same_host_allowed(self, webapp, monkeypatch):
        c, _ = _reload_web(monkeypatch)
        r = c.post("/api/v1/targets",
                   headers={"Origin": "http://localhost"},
                   json={"name": "x", "type": "kubernetes", "config": {}})
        assert r.status_code != 403

    def test_post_cross_origin_rejected(self, webapp, monkeypatch):
        c, _ = _reload_web(monkeypatch)
        r = c.post("/api/v1/targets",
                   headers={"Origin": "https://evil.example.com"},
                   json={"name": "x", "type": "kubernetes", "config": {}})
        assert r.status_code == 403
        assert b"origin" in r.data.lower()

    def test_allowlist_honored(self, webapp, monkeypatch):
        c, _ = _reload_web(monkeypatch, allowed_origins="https://app.example.com,https://admin.example.com")
        r = c.post("/api/v1/targets",
                   headers={"Origin": "https://app.example.com"},
                   json={"name": "x", "type": "kubernetes", "config": {}})
        assert r.status_code != 403

    def test_no_origin_no_referer_allowed(self, webapp, monkeypatch):
        """Server-side clients (curl, CI) carry no Origin/Referer. They
        rely on AZIRO_API_KEY, which auth already validated."""
        c, _ = _reload_web(monkeypatch)
        r = c.post("/api/v1/targets",
                   json={"name": "x", "type": "kubernetes", "config": {}})
        # Should not be 403 from Origin check (may be 200/400 from handler).
        assert r.status_code != 403

    def test_referer_fallback_rejected_when_cross_origin(self, webapp, monkeypatch):
        c, _ = _reload_web(monkeypatch)
        r = c.post("/api/v1/targets",
                   headers={"Referer": "https://evil.example.com/some/path"},
                   json={"name": "x", "type": "kubernetes", "config": {}})
        assert r.status_code == 403
        assert b"referer" in r.data.lower()
