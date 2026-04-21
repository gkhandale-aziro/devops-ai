"""
Tests for the incident lifecycle HTTP API:

  GET  /api/v1/incidents/<id>/transitions
  POST /api/v1/incidents/<id>/transition

We exercise the real EventStore (sqlite on tmp_path) so the state
machine + store + Flask wiring are proved end-to-end, not just in
isolation. Rate limits are widened with AZIRO_RATE_LIMIT so the 429s
from test_phase_f don't bleed in here.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch


def _isolated(monkeypatch, tmp_path, **env):
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    for key in ("AZIRO_API_KEY", "AZIRO_ALLOWED_ORIGINS", "AZIRO_ENABLE_HSTS",
                "AZIRO_PROXY_HOPS", "AZIRO_AUTH_MODE", "AZIRO_SESSION_SECRET",
                "AZIRO_RATE_LIMIT", "AZIRO_LIMITER_STORAGE"):
        monkeypatch.delenv(key, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)


def _reload_web():
    for mod in ("ui.web", "auth", "auth.db", "auth.middleware", "auth.routes",
                "store", "store.db"):
        sys.modules.pop(mod, None)
    import ui.web as web
    web.app.config["TESTING"] = True
    return web, web.app.test_client()


@pytest.fixture
def app(tmp_path, monkeypatch):
    """Full Flask app with real store — no mocks. Auth disabled
    (apikey mode + no AZIRO_API_KEY) so state-changing POSTs aren't
    blocked by role_check."""
    _isolated(monkeypatch, tmp_path,
              AZIRO_AUTH_MODE="apikey",
              AZIRO_SESSION_SECRET="test-secret",
              AZIRO_RATE_LIMIT="1000/minute")
    with patch("providers.LLMClient"), \
         patch("tools.ToolExecutor"), \
         patch("sessions.SessionManager") as MockSessions, \
         patch("targets.TargetManager") as MockTargets, \
         patch("agent.Agent"), \
         patch("agent.AgentSession"), \
         patch("store.metrics.MetricCollector"):
        MockTargets.return_value.load_safe.return_value = []
        MockSessions.return_value.load.return_value = []
        web, client = _reload_web()
        yield web, client


def _seed_event(web) -> int:
    """Insert one event directly via the store so we have an id to
    transition. Skips the Kubernetes ingest path."""
    return web._store.save_event(
        {"object": "paymentsvc", "reason": "CrashLoopBackOff",
         "namespace": "demo", "message": "crashloop"},
        "SEV2",
    )


class TestGetTransitions:
    def test_initial_timeline_has_detected_row(self, app):
        web, client = app
        eid = _seed_event(web)
        r = client.get(f"/api/v1/incidents/{eid}/transitions")
        assert r.status_code == 200
        body = r.get_json()
        assert body["event_id"] == eid
        assert len(body["transitions"]) == 1
        assert body["transitions"][0]["to_state"] == "Detected"

    def test_404_on_missing_event(self, app):
        web, client = app
        r = client.get("/api/v1/incidents/99999/transitions")
        assert r.status_code == 404


class TestPostTransition:
    def test_valid_transition_returns_200(self, app):
        web, client = app
        eid = _seed_event(web)
        r = client.post(f"/api/v1/incidents/{eid}/transition",
                        json={"to": "Triaging", "reason": "auto-triage"})
        assert r.status_code == 200, r.data
        body = r.get_json()
        assert body["from_state"] == "Detected"
        assert body["to_state"] == "Triaging"

        # The GET should now show both rows.
        rows = client.get(
            f"/api/v1/incidents/{eid}/transitions").get_json()["transitions"]
        assert [r["to_state"] for r in rows] == ["Detected", "Triaging"]

    def test_invalid_edge_returns_409(self, app):
        web, client = app
        eid = _seed_event(web)
        # Detected → Approved skips three states.
        r = client.post(f"/api/v1/incidents/{eid}/transition",
                        json={"to": "Approved"})
        assert r.status_code == 409
        body = r.get_json()
        assert body["error"] == "invalid transition"
        # Body must remain in the pre-request state.
        assert web._store.get_event(eid)["lifecycle_state"] == "Detected"

    def test_missing_event_returns_404(self, app):
        web, client = app
        r = client.post("/api/v1/incidents/99999/transition",
                        json={"to": "Triaging"})
        assert r.status_code == 404

    def test_body_missing_to_returns_400(self, app):
        web, client = app
        eid = _seed_event(web)
        r = client.post(f"/api/v1/incidents/{eid}/transition", json={})
        assert r.status_code == 400

    def test_approval_records_api_key_actor(self, app):
        """In apikey mode with no logged-in user, actor falls back to
        'api-key' — but approved_by still gets stamped so demo walkthroughs
        without a real login don't leave the column blank."""
        web, client = app
        eid = _seed_event(web)
        for to_state in ("Triaging", "Diagnosing", "Proposing"):
            r = client.post(f"/api/v1/incidents/{eid}/transition",
                            json={"to": to_state})
            assert r.status_code == 200, (to_state, r.data)

        r = client.post(f"/api/v1/incidents/{eid}/transition",
                        json={"to": "Approved", "reason": "demo approval"})
        assert r.status_code == 200
        evt = web._store.get_event(eid)
        assert evt["lifecycle_state"] == "Approved"
        assert evt["approved_by"] == "api-key"
        assert evt["approved_at"]
