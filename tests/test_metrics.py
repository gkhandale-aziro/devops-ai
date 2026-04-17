"""
Tests for observability/metrics.py — RUN-3.

Scope:
  - normalize_route() cardinality behavior (ids collapsed, length capped)
  - record_* helpers emit the expected label sets and values
  - metrics_handler() token auth (unset/open vs set/bearer)
  - /metrics route on the Flask app returns valid Prometheus text
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


# ── Route normalization ──────────────────────────────────────────────────────

class TestNormalizeRoute:
    def test_numeric_id_collapsed(self):
        from observability.metrics import normalize_route
        assert normalize_route("/api/v1/targets/42") == "/api/v1/targets/:id"

    def test_hex_id_collapsed(self):
        from observability.metrics import normalize_route
        assert normalize_route("/api/v1/chat/a1b2c3d4/stream") == "/api/v1/chat/:id/stream"

    def test_long_opaque_token_collapsed(self):
        from observability.metrics import normalize_route
        # 20+ alnum chars collapse (session tokens etc).
        assert normalize_route("/api/v1/sessions/abcdefghij0123456789/messages") == \
            "/api/v1/sessions/:id/messages"

    def test_short_word_segment_preserved(self):
        from observability.metrics import normalize_route
        # Short word segments (like 'stream', 'healthz') must NOT collapse.
        assert normalize_route("/api/v1/healthz") == "/api/v1/healthz"
        assert normalize_route("/api/v1/chat/stream") == "/api/v1/chat/stream"

    def test_empty_path(self):
        from observability.metrics import normalize_route
        assert normalize_route("") == "/"

    def test_length_capped(self):
        from observability.metrics import normalize_route
        long_path = "/api/v1/" + "x" * 500
        out = normalize_route(long_path)
        assert len(out) <= 80

    def test_two_ids_both_collapsed(self):
        from observability.metrics import normalize_route
        assert normalize_route("/api/v1/targets/42/sessions/99") == \
            "/api/v1/targets/:id/sessions/:id"


# ── Helper functions emit into the registry ─────────────────────────────────

class TestRecordHelpers:
    def _scrape(self):
        """Return /metrics body decoded to str."""
        from observability.metrics import metrics_handler
        body, status, _ = metrics_handler(None)
        assert status == 200
        return body.decode("utf-8")

    def test_record_http_request_emits_counter_and_histogram(self):
        from observability.metrics import record_http_request
        record_http_request("GET", "/api/v1/healthz", 200, 0.123)
        text = self._scrape()
        assert 'aziro_http_requests_total{method="GET",route="/api/v1/healthz",status="200"}' in text
        assert "aziro_http_request_duration_seconds_bucket" in text

    def test_record_http_request_normalizes_route_label(self):
        from observability.metrics import record_http_request
        record_http_request("GET", "/api/v1/targets/777", 200, 0.05)
        text = self._scrape()
        # The id must NOT appear as a raw label — it must be collapsed.
        assert "/api/v1/targets/777" not in text
        assert 'route="/api/v1/targets/:id"' in text

    def test_record_llm_call_ok_with_tokens(self):
        from observability.metrics import record_llm_call
        record_llm_call(
            "gemini-2.0-flash",
            1.5,
            outcome="ok",
            stream=False,
            prompt_tokens=100,
            completion_tokens=50,
        )
        text = self._scrape()
        assert 'aziro_llm_calls_total{model="gemini-2.0-flash",outcome="ok"}' in text
        assert 'aziro_llm_tokens_total{direction="prompt",model="gemini-2.0-flash"}' in text
        assert 'aziro_llm_tokens_total{direction="completion",model="gemini-2.0-flash"}' in text

    def test_record_llm_call_quota_outcome(self):
        from observability.metrics import record_llm_call
        record_llm_call("gemini-2.0-flash", 0.3, outcome="quota")
        text = self._scrape()
        assert 'aziro_llm_calls_total{model="gemini-2.0-flash",outcome="quota"}' in text

    def test_record_fallback_labels(self):
        from observability.metrics import record_fallback
        record_fallback(from_model="gemini-2.0-flash", to_model="ollama/llama3", reason="quota")
        text = self._scrape()
        assert 'aziro_llm_fallback_total{' in text
        assert 'from_model="gemini-2.0-flash"' in text
        assert 'to_model="ollama/llama3"' in text
        assert 'reason="quota"' in text

    def test_record_tool_call_emits_counter_and_histogram(self):
        from observability.metrics import record_tool_call
        record_tool_call("run_command", 0.8, "ok")
        text = self._scrape()
        assert 'aziro_tool_calls_total{outcome="ok",tool="run_command"}' in text
        assert "aziro_tool_call_duration_seconds_bucket" in text


# ── /metrics handler auth ────────────────────────────────────────────────────

class TestMetricsHandlerAuth:
    def test_open_when_token_unset(self, monkeypatch):
        monkeypatch.delenv("AZIRO_METRICS_TOKEN", raising=False)
        for m in list(sys.modules):
            if m.startswith("observability.metrics"):
                sys.modules.pop(m, None)
        from observability.metrics import metrics_handler
        body, status, headers = metrics_handler(None)
        assert status == 200
        assert headers["Content-Type"].startswith("text/plain")

    def test_unauthorized_when_token_set_no_header(self, monkeypatch):
        monkeypatch.setenv("AZIRO_METRICS_TOKEN", "secret-xyz")
        for m in list(sys.modules):
            if m.startswith("observability.metrics"):
                sys.modules.pop(m, None)
        from observability.metrics import metrics_handler
        body, status, _ = metrics_handler(None)
        assert status == 401

    def test_unauthorized_when_token_mismatch(self, monkeypatch):
        monkeypatch.setenv("AZIRO_METRICS_TOKEN", "secret-xyz")
        for m in list(sys.modules):
            if m.startswith("observability.metrics"):
                sys.modules.pop(m, None)
        from observability.metrics import metrics_handler
        _, status, _ = metrics_handler("Bearer wrong-token")
        assert status == 401

    def test_ok_when_bearer_token_matches(self, monkeypatch):
        monkeypatch.setenv("AZIRO_METRICS_TOKEN", "secret-xyz")
        for m in list(sys.modules):
            if m.startswith("observability.metrics"):
                sys.modules.pop(m, None)
        from observability.metrics import metrics_handler
        _, status, _ = metrics_handler("Bearer secret-xyz")
        assert status == 200


# ── /metrics Flask route integration ─────────────────────────────────────────

@pytest.fixture
def fresh_app(tmp_path, monkeypatch):
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    for key in ("AZIRO_API_KEY", "AZIRO_AUTH_MODE", "AZIRO_SESSION_SECRET",
                "AZIRO_BOOTSTRAP_ADMIN_USER", "AZIRO_BOOTSTRAP_ADMIN_PASSWORD",
                "AZIRO_METRICS_TOKEN", "AZIRO_RATE_LIMIT"):
        monkeypatch.delenv(key, raising=False)
    for m in ("ui.web", "store", "store.db", "store.metrics",
              "sessions", "sessions.manager",
              "targets", "targets.manager",
              "auth", "auth.db", "auth.middleware", "auth.routes",
              "observability", "observability.metrics"):
        sys.modules.pop(m, None)
    import ui.web as web_mod
    web_mod.app.config["TESTING"] = True
    return web_mod, web_mod.app.test_client()


class TestMetricsRoute:
    def test_metrics_endpoint_returns_prometheus_text(self, fresh_app):
        _, c = fresh_app
        # Hit a route so at least one counter has something to report.
        c.get("/api/v1/healthz")
        r = c.get("/metrics")
        assert r.status_code == 200
        assert r.headers["Content-Type"].startswith("text/plain")
        body = r.get_data(as_text=True)
        # Exposition format marker lines.
        assert "# HELP" in body
        assert "# TYPE" in body
        # Our HTTP counter should be present after the healthz call above.
        assert "aziro_http_requests_total" in body

    def test_metrics_endpoint_bypasses_api_auth(self, fresh_app, monkeypatch):
        """/metrics is scraped by Prometheus — it must not require API key
        or session auth, which are enforced only on /api/ routes."""
        monkeypatch.setenv("AZIRO_API_KEY", "should-not-matter-for-metrics")
        _, c = fresh_app
        r = c.get("/metrics")
        # No API key in the request, yet /metrics must still succeed.
        assert r.status_code == 200
