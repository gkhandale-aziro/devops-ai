"""
Tests for Phase C — observability.

M-05: Every request carries a stable X-Request-ID that is:
      - honored if inbound, minted fresh otherwise
      - echoed in the response header
      - present as "request_id" in structured log output
M-06: /api/v1/healthz is liveness (200, no deps).
      /api/v1/readyz flips to 503 when a dep fails.
"""
import io
import json
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch


# ── fixture — mirrors Phase B's source-class patching to avoid real singletons ─

@pytest.fixture
def client():
    sys.modules.pop("ui.web", None)
    with patch("providers.LLMClient"), \
         patch("tools.ToolExecutor"), \
         patch("sessions.SessionManager") as MockSessions, \
         patch("targets.TargetManager") as MockTargets, \
         patch("agent.Agent"), \
         patch("agent.AgentSession"), \
         patch("store.EventStore") as MockStore, \
         patch("store.metrics.MetricCollector"):
        MockTargets.return_value.has_local.return_value = True
        MockSessions.return_value.load.return_value = []
        # _conn().execute("SELECT 1").fetchone() chain must succeed by default.
        MockStore.return_value._conn.return_value.execute.return_value.fetchone.return_value = (1,)
        # /readyz now keys the DB check off the dialect name; give the
        # mock a concrete string so jsonify() doesn't choke on a
        # MagicMock. Tests assert the resulting `"sqlite"` key below.
        MockStore.return_value._engine.dialect.name = "sqlite"
        from ui.web import app
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c, MockSessions.return_value, MockStore.return_value


# ── M-05 request-ID middleware ───────────────────────────────────────────────

class TestRequestIdMiddleware:
    def test_mints_request_id_when_absent(self, client):
        c, _, _ = client
        r = c.get("/api/v1/healthz")
        assert "X-Request-ID" in r.headers
        # UUID4 hex — 32 chars of [0-9a-f].
        rid = r.headers["X-Request-ID"]
        assert len(rid) == 32 and all(ch in "0123456789abcdef" for ch in rid)

    def test_honors_inbound_request_id(self, client):
        c, _, _ = client
        r = c.get("/api/v1/healthz", headers={"X-Request-ID": "client-abc-123"})
        assert r.headers["X-Request-ID"] == "client-abc-123"

    def test_rejects_malformed_inbound_id(self, client):
        """Junk inbound IDs (whitespace, CRLF, 200-char garbage) must not
        propagate — the server generates a safe replacement."""
        c, _, _ = client
        bad = "a" * 500  # exceeds the 128-char shape cap
        r = c.get("/api/v1/healthz", headers={"X-Request-ID": bad})
        echoed = r.headers["X-Request-ID"]
        assert echoed != bad
        assert len(echoed) == 32  # minted UUID4 hex


class TestRequestLogFormat:
    def _capture(self):
        """Install a stream handler that uses the JSON formatter so tests can
        read log lines back as parsed JSON."""
        from observability.logging import _JsonFormatter
        buf = io.StringIO()
        h = logging.StreamHandler(buf)
        h.setFormatter(_JsonFormatter())
        logging.getLogger().addHandler(h)
        return buf, h

    def test_request_log_is_json_and_has_request_id(self, client):
        c, _, _ = client
        buf, h = self._capture()
        try:
            r = c.get("/api/v1/healthz", headers={"X-Request-ID": "trace-42"})
            assert r.status_code == 200
            # Multiple log lines may be emitted — find the request line.
            lines = [ln for ln in buf.getvalue().splitlines() if ln.strip()]
            request_lines = []
            for ln in lines:
                try:
                    obj = json.loads(ln)
                except json.JSONDecodeError:
                    pytest.fail(f"log line is not valid JSON: {ln!r}")
                if obj.get("msg") == "request":
                    request_lines.append(obj)
            assert request_lines, "no structured request log emitted"
            entry = request_lines[-1]
            assert entry["request_id"] == "trace-42"
            assert entry["method"]     == "GET"
            assert entry["path"]       == "/api/v1/healthz"
            assert entry["status"]     == 200
            assert entry["duration_ms"] >= 0
        finally:
            logging.getLogger().removeHandler(h)


# ── M-06 health probes ───────────────────────────────────────────────────────

class TestHealthz:
    def test_healthz_returns_200(self, client):
        c, _, _ = client
        r = c.get("/api/v1/healthz")
        assert r.status_code == 200
        assert r.get_json() == {"status": "ok"}

    def test_healthz_bypasses_auth(self, client):
        """liveness probes don't send Bearer tokens — route must be open."""
        c, _, _ = client
        # No Authorization header.
        r = c.get("/api/v1/healthz")
        assert r.status_code == 200


class TestReadyz:
    def test_readyz_ok_when_deps_healthy(self, client):
        c, _, _ = client
        r = c.get("/api/v1/readyz")
        assert r.status_code == 200
        body = r.get_json()
        assert body["status"]            == "ok"
        assert body["checks"]["sqlite"]  == "ok"
        assert body["checks"]["sessions"] == "ok"

    def test_readyz_503_when_sqlite_fails(self, client):
        c, _, mock_store = client
        mock_store._conn.side_effect = RuntimeError("disk full")
        r = c.get("/api/v1/readyz")
        assert r.status_code == 503
        body = r.get_json()
        assert body["status"] == "unavailable"
        assert body["checks"]["sqlite"].startswith("fail")

    def test_readyz_503_when_sessions_fail(self, client):
        c, mock_sessions, _ = client
        mock_sessions.load.side_effect = OSError("read-only fs")
        r = c.get("/api/v1/readyz")
        assert r.status_code == 503
        assert r.get_json()["checks"]["sessions"].startswith("fail")


# ── sanity: observability helpers are idempotent ─────────────────────────────

class TestLoggingConfiguration:
    def test_configure_logging_is_idempotent(self):
        """Repeated configure_logging() calls must not stack handlers
        (which would cause log-line duplication in long-running processes)."""
        import logging as _logging
        from observability.logging import configure_logging
        configure_logging()
        configure_logging()
        configure_logging()
        # Our handler is the one writing to stderr with the JSON formatter.
        root_handlers = _logging.getLogger().handlers
        assert len(root_handlers) == 1

    def test_request_id_context_is_per_context(self):
        from observability.logging import (
            bind_request_id, current_request_id, clear_request_id,
        )
        clear_request_id()
        assert current_request_id() is None
        bind_request_id("abc")
        assert current_request_id() == "abc"
        clear_request_id()
        assert current_request_id() is None
