"""
Tests for ui/web.py route handlers — Phase F.6a.

Coverage focus: routes that previously had ZERO direct test coverage
(health/readyz/info, models, sessions, events, stats, feedback).

These complement existing tests:
  - test_web_security.py     auth, headers, IDOR, masking, command injection
  - test_phase_d.py          CSRF Origin check
  - test_phase_e.py          login/logout, role enforcement
  - test_phase_f.py          rate limiting

We keep the lightweight pattern from test_web_security: reload the module
under fresh env, talk to the test client directly. Real EventStore /
TargetManager / SessionManager are exercised against a temp data dir so
behavior under realistic state is validated, not just shape.
"""
from __future__ import annotations

import os
import sys
import importlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


# ── shared fixture ───────────────────────────────────────────────────────────

@pytest.fixture
def fresh_app(tmp_path, monkeypatch):
    """Reload ui.web pointed at a fresh temp data dir with auth disabled.

    Auth is left off (no AZIRO_API_KEY, default mode=apikey) so each test
    only deals with the route logic it cares about — auth has its own
    coverage in test_phase_e.py and test_web_security.py."""
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    for key in ("AZIRO_API_KEY", "AZIRO_AUTH_MODE", "AZIRO_SESSION_SECRET",
                "AZIRO_BOOTSTRAP_ADMIN_USER", "AZIRO_BOOTSTRAP_ADMIN_PASSWORD",
                "AZIRO_ALLOWED_ORIGINS", "AZIRO_ENABLE_HSTS",
                "AZIRO_RATE_LIMIT", "AZIRO_CHAT_STREAM_LIMITS",
                "AZIRO_LOGIN_LIMITS", "AZIRO_LIMITER_STORAGE"):
        monkeypatch.delenv(key, raising=False)

    # Drop cached modules so import-time singletons (EventStore, TargetManager,
    # SessionManager) re-bind to the temp data dir.
    for m in ("ui.web", "store", "store.db", "store.metrics",
              "sessions", "sessions.manager",
              "targets", "targets.manager",
              "auth", "auth.db", "auth.middleware", "auth.routes"):
        sys.modules.pop(m, None)

    import ui.web as web_mod
    web_mod.app.config["TESTING"] = True
    return web_mod, web_mod.app.test_client()


# ── /api/v1/healthz, /readyz, /info ──────────────────────────────────────────

class TestHealthAndInfo:
    def test_healthz_returns_200(self, fresh_app):
        _, c = fresh_app
        r = c.get("/api/v1/healthz")
        assert r.status_code == 200

    def test_healthz_no_auth_required(self, fresh_app, monkeypatch):
        """healthz is in _UNAUTH_PROBE_PATHS — kubelet probes never carry
        auth headers, so 401 here would crash-loop the pod."""
        monkeypatch.setenv("AZIRO_API_KEY", "x")
        web_mod, _ = fresh_app
        importlib.reload(web_mod)
        r = web_mod.app.test_client().get("/api/v1/healthz")
        assert r.status_code == 200

    def test_readyz_returns_json_status(self, fresh_app):
        _, c = fresh_app
        r = c.get("/api/v1/readyz")
        # readyz may return 200 or 503 depending on dep state, but it must
        # always return JSON with a status field.
        assert r.status_code in (200, 503)
        assert "status" in r.get_json()

    def test_info_returns_version_and_mode(self, fresh_app):
        _, c = fresh_app
        r = c.get("/api/v1/info")
        assert r.status_code == 200
        body = r.get_json()
        # Don't pin specific keys (would couple test to wire format), just
        # verify it's a non-empty JSON object.
        assert isinstance(body, dict) and body


# ── /api/v1/models ───────────────────────────────────────────────────────────

class TestModelsAPI:
    def test_models_list_returns_dict(self, fresh_app):
        _, c = fresh_app
        r = c.get("/api/v1/models")
        assert r.status_code == 200
        body = r.get_json()
        # Shape: {cloud: [...], ollama: [...], current?: ...}
        assert isinstance(body, dict)

    def test_models_health_returns_status(self, fresh_app):
        _, c = fresh_app
        r = c.get("/api/v1/models/health")
        assert r.status_code == 200
        body = r.get_json()
        assert "status" in body or "model" in body

    def test_models_put_empty_is_noop(self, fresh_app):
        """Empty PUT is a legal no-op — caller hasn't asked to change anything."""
        _, c = fresh_app
        r = c.put("/api/v1/models", json={})
        assert r.status_code == 200

    def test_models_put_rejects_bad_type(self, fresh_app):
        _, c = fresh_app
        r = c.put("/api/v1/models", json={"ai_model": 123})
        assert r.status_code == 400

    def test_models_put_rejects_bad_string(self, fresh_app):
        """_MODEL_RE requires alnum start + safe chars; reject shell-ish input."""
        _, c = fresh_app
        r = c.put("/api/v1/models", json={"ai_model": "bad model; rm -rf /"})
        assert r.status_code == 400

    def test_ollama_url_get_returns_current(self, fresh_app):
        _, c = fresh_app
        r = c.get("/api/v1/models/ollama-url")
        assert r.status_code == 200
        body = r.get_json()
        assert "url" in body or "ollama_api_base" in body

    def test_ollama_url_put_validates_payload(self, fresh_app):
        _, c = fresh_app
        r = c.put("/api/v1/models/ollama-url", json={})
        assert r.status_code == 400


# ── /api/v1/sessions ─────────────────────────────────────────────────────────

class TestSessionsAPI:
    def test_sessions_list_starts_empty(self, fresh_app):
        _, c = fresh_app
        r = c.get("/api/v1/sessions")
        assert r.status_code == 200
        body = r.get_json()
        # May be a list directly or {"sessions": [...]}
        sessions = body if isinstance(body, list) else body.get("sessions", [])
        assert isinstance(sessions, list)

    def test_session_create_returns_id(self, fresh_app):
        _, c = fresh_app
        r = c.post("/api/v1/sessions", json={})
        assert r.status_code == 200
        body = r.get_json()
        assert "id" in body or "session_id" in body or "sid" in body

    def test_session_create_then_list_includes_it(self, fresh_app):
        _, c = fresh_app
        r = c.post("/api/v1/sessions", json={})
        body = r.get_json()
        sid = body.get("id") or body.get("session_id") or body.get("sid")
        assert sid

        r = c.get("/api/v1/sessions")
        body = r.get_json()
        sessions = body if isinstance(body, list) else body.get("sessions", [])
        assert any(
            (s.get("id") == sid or s.get("session_id") == sid or s.get("sid") == sid)
            for s in sessions
        )

    def test_session_messages_empty_for_new(self, fresh_app):
        _, c = fresh_app
        r = c.post("/api/v1/sessions", json={})
        sid = (r.get_json().get("id")
               or r.get_json().get("session_id")
               or r.get_json().get("sid"))
        r = c.get(f"/api/v1/sessions/{sid}/messages")
        assert r.status_code == 200
        body = r.get_json()
        msgs = body if isinstance(body, list) else body.get("messages", [])
        assert msgs == []

    def test_session_delete_then_404(self, fresh_app):
        _, c = fresh_app
        r = c.post("/api/v1/sessions", json={})
        sid = (r.get_json().get("id")
               or r.get_json().get("session_id")
               or r.get_json().get("sid"))
        d = c.delete(f"/api/v1/sessions/{sid}")
        assert d.status_code in (200, 204)
        # Subsequent fetch must 404
        m = c.get(f"/api/v1/sessions/{sid}/messages")
        assert m.status_code == 404


# ── /api/v1/events ───────────────────────────────────────────────────────────

class TestEventsAPI:
    def _seed(self, web_mod, level="SEV2", obj="crashloop", reason="CrashLoopBackOff"):
        return web_mod._store.save_event(
            {"object": obj, "reason": reason, "namespace": "demo",
             "message": f"{reason} on {obj}", "type": "Warning"},
            level,
        )

    def test_events_list_empty(self, fresh_app):
        _, c = fresh_app
        r = c.get("/api/v1/events")
        assert r.status_code == 200
        body = r.get_json()
        events = body if isinstance(body, list) else body.get("events", [])
        assert events == []

    def test_events_list_returns_seeded(self, fresh_app):
        web, c = fresh_app
        self._seed(web)
        r = c.get("/api/v1/events")
        assert r.status_code == 200
        body = r.get_json()
        events = body if isinstance(body, list) else body.get("events", [])
        assert len(events) == 1
        assert events[0]["reason"] == "CrashLoopBackOff"

    def test_events_filter_by_level(self, fresh_app):
        web, c = fresh_app
        self._seed(web, level="SEV1", obj="node-x", reason="NodeNotReady")
        self._seed(web, level="SEV2")

        r = c.get("/api/v1/events?level=SEV1")
        body = r.get_json()
        events = body if isinstance(body, list) else body.get("events", [])
        assert len(events) == 1
        assert events[0]["level"] == "SEV1"

    def test_events_get_one_includes_snapshots(self, fresh_app):
        web, c = fresh_app
        eid = self._seed(web)
        web._store.save_snapshot(eid, "logs", "fake log line")

        r = c.get(f"/api/v1/events/{eid}")
        assert r.status_code == 200
        body = r.get_json()
        assert body["id"] == eid
        assert any(s["kind"] == "logs" for s in body["snapshots"])

    def test_events_patch_status_acknowledged(self, fresh_app):
        web, c = fresh_app
        eid = self._seed(web)

        r = c.patch(f"/api/v1/events/{eid}",
                    json={"status": "acknowledged"})
        assert r.status_code == 200

        r = c.get(f"/api/v1/events/{eid}")
        assert r.get_json()["status"] == "acknowledged"

    def test_events_patch_rejects_unknown_status(self, fresh_app):
        web, c = fresh_app
        eid = self._seed(web)
        r = c.patch(f"/api/v1/events/{eid}",
                    json={"status": "magic"})
        assert r.status_code == 400


# ── /api/v1/stats — covers PR #20 distinct-active-issue count ────────────────

class TestStatsRoute:
    def test_stats_empty(self, fresh_app):
        _, c = fresh_app
        r = c.get("/api/v1/stats")
        assert r.status_code == 200
        body = r.get_json()
        assert body["counts"] == {}

    def test_stats_counts_distinct_open_issues(self, fresh_app):
        """Regression guard for PR #20: same (object, reason) firing many
        times must count as ONE active issue, not N."""
        web, c = fresh_app
        for _ in range(50):
            web._store.save_event(
                {"object": "crashloop", "reason": "CrashLoopBackOff",
                 "namespace": "demo", "message": "x", "type": "Warning"},
                "SEV2",
            )
        web._store.save_event(
            {"object": "oom-pod", "reason": "OOMKilled",
             "namespace": "demo", "message": "x", "type": "Warning"},
            "SEV2",
        )
        r = c.get("/api/v1/stats")
        assert r.get_json()["counts"]["SEV2"] == 2  # crashloop + oom-pod

    def test_stats_excludes_resolved(self, fresh_app):
        web, c = fresh_app
        eid = web._store.save_event(
            {"object": "crashloop", "reason": "CrashLoopBackOff",
             "namespace": "demo", "message": "x", "type": "Warning"},
            "SEV2",
        )
        web._store.update_event_status(eid, "resolved")
        r = c.get("/api/v1/stats")
        assert r.get_json()["counts"].get("SEV2", 0) == 0


# ── /api/v1/feedback ─────────────────────────────────────────────────────────

class TestFeedbackRoute:
    def test_feedback_post_records(self, fresh_app):
        _, c = fresh_app
        r = c.post("/api/v1/feedback", json={
            "target_id": "t1", "message": "test", "rating": "up", "comment": "",
        })
        assert r.status_code in (200, 201)

    def test_feedback_validates_rating(self, fresh_app):
        _, c = fresh_app
        r = c.post("/api/v1/feedback", json={
            "target_id": "t1", "message": "test", "rating": "maybe",
        })
        assert r.status_code == 400

    def test_feedback_validates_required_fields(self, fresh_app):
        _, c = fresh_app
        r = c.post("/api/v1/feedback", json={})
        assert r.status_code == 400


# ── SPA fallback (/, /<path>) ────────────────────────────────────────────────

class TestSPARouting:
    def test_root_returns_html_or_404(self, fresh_app):
        _, c = fresh_app
        r = c.get("/")
        # Index.html exists in dev/prod builds; missing in CI without frontend.
        # Either 200 (served) or 404 (no build) is fine — the assertion is
        # "no auth/server crash on SPA root."
        assert r.status_code in (200, 404)

    def test_unknown_spa_path_falls_back(self, fresh_app):
        _, c = fresh_app
        r = c.get("/dashboard")
        assert r.status_code in (200, 404)
