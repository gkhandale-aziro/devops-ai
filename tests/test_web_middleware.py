"""
Tests for ui/web.py cross-cutting middleware — Phase F.6a.

Covers middleware that every request passes through but had no
direct tests:
  - Request-ID binding (X-Request-ID in, X-Request-ID out)
  - Body size cap       (AZIRO_MAX_BODY_MB → 413)
  - Message char cap    (AZIRO_MAX_MESSAGE_CHARS → 400)
  - Security headers    (X-Content-Type-Options, X-Frame-Options,
                         Referrer-Policy, X-API-Version, Cache-Control)

Auth is left off so failures are attributable to middleware, not auth
(auth has its own coverage in test_phase_e.py / test_web_security.py).
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


@pytest.fixture
def fresh_app(tmp_path, monkeypatch):
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    for key in ("AZIRO_API_KEY", "AZIRO_AUTH_MODE", "AZIRO_SESSION_SECRET",
                "AZIRO_BOOTSTRAP_ADMIN_USER", "AZIRO_BOOTSTRAP_ADMIN_PASSWORD",
                "AZIRO_ALLOWED_ORIGINS", "AZIRO_ENABLE_HSTS",
                "AZIRO_RATE_LIMIT", "AZIRO_CHAT_STREAM_LIMITS",
                "AZIRO_LOGIN_LIMITS", "AZIRO_LIMITER_STORAGE",
                "AZIRO_MAX_BODY_MB", "AZIRO_MAX_MESSAGE_CHARS"):
        monkeypatch.delenv(key, raising=False)
    for m in ("ui.web", "store", "store.db", "store.metrics",
              "sessions", "sessions.manager",
              "targets", "targets.manager",
              "auth", "auth.db", "auth.middleware", "auth.routes"):
        sys.modules.pop(m, None)
    import ui.web as web_mod
    web_mod.app.config["TESTING"] = True
    return web_mod, web_mod.app.test_client()


# ── Request-ID middleware ────────────────────────────────────────────────────

class TestRequestID:
    def test_response_always_has_request_id_header(self, fresh_app):
        _, c = fresh_app
        r = c.get("/api/v1/healthz")
        assert r.headers.get("X-Request-ID"), "middleware must set X-Request-ID"

    def test_inbound_request_id_is_honored(self, fresh_app):
        """A well-formed X-Request-ID from a client (e.g. a gateway) must
        be preserved end-to-end for distributed tracing."""
        _, c = fresh_app
        rid = "abc123-def456-0000"
        r = c.get("/api/v1/healthz", headers={"X-Request-ID": rid})
        assert r.headers.get("X-Request-ID") == rid

    def test_malformed_request_id_is_replaced(self, fresh_app):
        """Clients can't smuggle arbitrary strings — the allowlist regex
        (^[A-Za-z0-9._\\-]{1,128}$) rejects spaces / semicolons / anything
        that could interfere with log parsing downstream."""
        _, c = fresh_app
        bad = "bad id with spaces"  # spaces disallowed by regex
        r = c.get("/api/v1/healthz", headers={"X-Request-ID": bad})
        out = r.headers.get("X-Request-ID", "")
        assert out and out != bad


# ── Body size cap (413) ──────────────────────────────────────────────────────

class TestBodySizeCap:
    def test_large_body_returns_413(self, tmp_path, monkeypatch):
        """Bodies over AZIRO_MAX_BODY_MB must be refused before hitting a
        handler — defense against memory-exhaustion POST."""
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
        monkeypatch.setenv("AZIRO_MAX_BODY_MB", "1")
        for key in ("AZIRO_API_KEY", "AZIRO_AUTH_MODE", "AZIRO_SESSION_SECRET",
                    "AZIRO_ALLOWED_ORIGINS", "AZIRO_MAX_MESSAGE_CHARS"):
            monkeypatch.delenv(key, raising=False)
        for m in ("ui.web", "store", "store.db", "auth", "auth.db",
                  "auth.middleware", "auth.routes"):
            sys.modules.pop(m, None)
        import ui.web as web_mod
        web_mod.app.config["TESTING"] = True
        c = web_mod.app.test_client()

        # 2 MB payload > 1 MB cap
        payload = {"prompt": "x" * (2 * 1024 * 1024)}
        r = c.post("/api/v1/analyze", json=payload)
        assert r.status_code == 413


# ── Per-message character cap (400) ──────────────────────────────────────────

class TestMessageCharCap:
    def test_oversized_prompt_returns_400(self, tmp_path, monkeypatch):
        """Even under the body cap, individual messages get a tighter char
        cap so one request can't burn arbitrary LLM token budget."""
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
        monkeypatch.setenv("AZIRO_MAX_MESSAGE_CHARS", "100")
        for key in ("AZIRO_API_KEY", "AZIRO_AUTH_MODE", "AZIRO_SESSION_SECRET",
                    "AZIRO_ALLOWED_ORIGINS", "AZIRO_MAX_BODY_MB"):
            monkeypatch.delenv(key, raising=False)
        for m in ("ui.web", "store", "store.db", "auth", "auth.db",
                  "auth.middleware", "auth.routes"):
            sys.modules.pop(m, None)
        import ui.web as web_mod
        web_mod.app.config["TESTING"] = True
        c = web_mod.app.test_client()

        r = c.post("/api/v1/analyze", json={"prompt": "x" * 500})
        assert r.status_code == 400
        body = r.get_json()
        assert body["error"] == "prompt too long"
        assert body["max_chars"] == 100
        assert body["got_chars"] == 500

    def test_under_cap_prompt_passes_middleware(self, fresh_app):
        """A prompt under the cap must not get rejected by the middleware —
        it may still 500 downstream (mocked LLM), but never 400/413."""
        _, c = fresh_app
        r = c.post("/api/v1/analyze", json={"prompt": "short prompt"})
        assert r.status_code not in (400, 413)

    def test_empty_prompt_returns_400(self, fresh_app):
        _, c = fresh_app
        r = c.post("/api/v1/analyze", json={"prompt": ""})
        assert r.status_code == 400
        assert r.get_json()["error"] == "empty prompt"


# ── Security headers ─────────────────────────────────────────────────────────

class TestSecurityHeaders:
    def test_baseline_headers_on_every_response(self, fresh_app):
        _, c = fresh_app
        r = c.get("/api/v1/healthz")
        assert r.headers.get("X-Content-Type-Options") == "nosniff"
        assert r.headers.get("X-Frame-Options") == "DENY"
        assert r.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
        assert r.headers.get("X-API-Version") == "1"

    def test_json_response_is_no_store(self, fresh_app):
        """JSON APIs must never be cached — stale auth state or alert data
        cached by a proxy is a real foot-gun."""
        _, c = fresh_app
        r = c.get("/api/v1/info")
        assert "json" in r.content_type
        assert r.headers.get("Cache-Control") == "no-store"

    def test_hsts_absent_over_http(self, fresh_app):
        """HSTS must not be set on plain HTTP — browsers ignore it but
        leaving it out makes the intent explicit and avoids accidentally
        sending it in contexts where it would be wrong."""
        _, c = fresh_app
        r = c.get("/api/v1/healthz")
        assert "Strict-Transport-Security" not in r.headers
