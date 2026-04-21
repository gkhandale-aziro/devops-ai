"""
Tests for DB-2 / PR-B — Redis 7 integration.

Four seams wire into Redis. Each gets its own class below so a failure
pinpoints the broken integration, not just "Redis tests are red":

  1. `observability.redis_client` — lazy singleton, env-var driven,
     degrades to None when unset or lib missing
  2. Flask-Limiter storage — AZIRO_REDIS_URL falls back to memory://
     only when both AZIRO_LIMITER_STORAGE and AZIRO_REDIS_URL are empty
  3. Flask-Session backend — AZIRO_SESSION_TYPE=redis plus a reachable
     client flips sessions to server-side; missing client stays cookie
  4. Monitor SSE pub/sub — `_broadcast_alert` publishes on the shared
     channel when Redis is configured, else it falls straight through
     to the in-process queue fan-out
  5. /readyz — adds a `redis` check only when the URL is set; reports
     `ok` / `fail: ...` and flips the response to 503 on failure

All Redis usage in tests runs against `fakeredis` — no network, no
container. The real `redis.Redis.from_url` path is stubbed per test so
`observability.redis_client` hands back a fakeredis client the same way
it would a real one.
"""
from __future__ import annotations

import json
import os
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── helpers ──────────────────────────────────────────────────────────────────


def _install_fakeredis(url: str = "redis://fake:6379/0"):
    """Return a (fake_client, patches) tuple. The patches set
    AZIRO_REDIS_URL and make `redis.Redis.from_url(...)` return the fake."""
    import fakeredis
    fake = fakeredis.FakeRedis()
    env_patch = patch.dict(os.environ, {"AZIRO_REDIS_URL": url})
    from_url_patch = patch("redis.Redis.from_url", return_value=fake)
    return fake, (env_patch, from_url_patch)


def _reset_client():
    from observability import redis_client
    redis_client.reset_for_tests()


# ── 1. redis_client singleton ────────────────────────────────────────────────


class TestRedisClientSingleton:
    def test_unset_url_returns_none(self, monkeypatch):
        monkeypatch.delenv("AZIRO_REDIS_URL", raising=False)
        _reset_client()
        from observability.redis_client import get_redis, ping, is_configured
        assert get_redis() is None
        assert ping() is False
        assert is_configured() is False

    def test_whitespace_url_is_treated_as_unset(self, monkeypatch):
        monkeypatch.setenv("AZIRO_REDIS_URL", "   ")
        _reset_client()
        from observability.redis_client import get_redis, is_configured
        assert get_redis() is None
        assert is_configured() is False

    def test_url_set_returns_client_and_is_cached(self, monkeypatch):
        fake, (ep, fp) = _install_fakeredis()
        _reset_client()
        with ep, fp as mock_from_url:
            from observability.redis_client import get_redis
            c1 = get_redis()
            c2 = get_redis()
            assert c1 is fake and c2 is fake
            # cache must not re-invoke from_url for the same URL
            assert mock_from_url.call_count == 1

    def test_ping_true_on_live_fake(self, monkeypatch):
        fake, (ep, fp) = _install_fakeredis()
        _reset_client()
        with ep, fp:
            from observability.redis_client import ping
            assert ping() is True

    def test_ping_false_when_redis_raises(self, monkeypatch):
        monkeypatch.setenv("AZIRO_REDIS_URL", "redis://bad:1/0")
        _reset_client()
        class _Broken:
            def ping(self):
                raise RuntimeError("conn refused")
        with patch("redis.Redis.from_url", return_value=_Broken()):
            from observability.redis_client import ping
            assert ping() is False  # swallowed, not raised


# ── 2. flask-limiter storage URI resolution ──────────────────────────────────


class TestLimiterStorageUri:
    """Module-import-time wiring — isolate by popping ui.web before each
    test so the os.environ snapshot is fresh."""

    def _import_web(self):
        sys.modules.pop("ui.web", None)
        with patch("providers.LLMClient"), \
             patch("tools.ToolExecutor"), \
             patch("sessions.SessionManager"), \
             patch("targets.TargetManager"), \
             patch("agent.Agent"), \
             patch("agent.AgentSession"), \
             patch("store.EventStore"), \
             patch("store.metrics.MetricCollector"), \
             patch("auth.AuthStore") as MockAuth:
            MockAuth.return_value.count_users.return_value = 1
            import ui.web as web
            return web

    def test_memory_fallback_when_nothing_set(self, monkeypatch):
        monkeypatch.delenv("AZIRO_LIMITER_STORAGE", raising=False)
        monkeypatch.delenv("AZIRO_REDIS_URL", raising=False)
        web = self._import_web()
        assert web._LIMITER_STORAGE_URI == "memory://"

    def test_explicit_limiter_storage_wins_over_redis_url(self, monkeypatch):
        # Two different redis URIs so we can tell which one won without
        # pulling in extra deps. Flask-Limiter's storage constructor calls
        # `redis.Redis.from_url` which is lazy (no TCP on construction),
        # so this doesn't hit the network.
        monkeypatch.setenv("AZIRO_LIMITER_STORAGE", "redis://explicit:6379/0")
        monkeypatch.setenv("AZIRO_REDIS_URL", "redis://other:6379/0")
        web = self._import_web()
        assert web._LIMITER_STORAGE_URI == "redis://explicit:6379/0"

    def test_redis_url_used_when_limiter_storage_unset(self, monkeypatch):
        monkeypatch.delenv("AZIRO_LIMITER_STORAGE", raising=False)
        monkeypatch.setenv("AZIRO_REDIS_URL", "redis://primary:6379/0")
        web = self._import_web()
        assert web._LIMITER_STORAGE_URI == "redis://primary:6379/0"


# ── 3. flask-session backend ────────────────────────────────────────────────


class TestSessionBackend:
    def _import_web(self):
        sys.modules.pop("ui.web", None)
        with patch("providers.LLMClient"), \
             patch("tools.ToolExecutor"), \
             patch("sessions.SessionManager"), \
             patch("targets.TargetManager"), \
             patch("agent.Agent"), \
             patch("agent.AgentSession"), \
             patch("store.EventStore"), \
             patch("store.metrics.MetricCollector"), \
             patch("auth.AuthStore") as MockAuth:
            MockAuth.return_value.count_users.return_value = 1
            import ui.web as web
            return web

    def test_cookie_backend_when_session_type_unset(self, monkeypatch):
        monkeypatch.delenv("AZIRO_SESSION_TYPE", raising=False)
        web = self._import_web()
        # Flask's default session_interface is SecureCookieSessionInterface.
        from flask.sessions import SecureCookieSessionInterface
        assert isinstance(web.app.session_interface, SecureCookieSessionInterface)

    def test_redis_session_selected_when_opted_in(self, monkeypatch):
        fake, (ep, fp) = _install_fakeredis()
        monkeypatch.setenv("AZIRO_SESSION_TYPE", "redis")
        _reset_client()
        with ep, fp:
            web = self._import_web()
            # After flask-session wiring the interface swaps out. We verify
            # via config rather than a concrete class (flask-session
            # internals vary by version).
            assert web.app.config.get("SESSION_TYPE") == "redis"
            assert web.app.config.get("SESSION_KEY_PREFIX") == "aziro:sess:"

    def test_redis_session_opt_in_but_no_url_falls_back_to_cookie(self, monkeypatch):
        monkeypatch.setenv("AZIRO_SESSION_TYPE", "redis")
        monkeypatch.delenv("AZIRO_REDIS_URL", raising=False)
        _reset_client()
        web = self._import_web()
        # SESSION_TYPE was never committed to the app config.
        assert web.app.config.get("SESSION_TYPE") != "redis"


# ── 4. monitor SSE pub/sub ──────────────────────────────────────────────────


class TestMonitorPubSub:
    """`_broadcast_alert` has two code paths:
      - Redis configured → r.publish(channel, json)
      - Redis absent     → _fan_out_local(event) straight through
    The subscriber loop then reverses publish into fan-out locally."""

    def _import_web(self):
        sys.modules.pop("ui.web", None)
        with patch("providers.LLMClient"), \
             patch("tools.ToolExecutor"), \
             patch("sessions.SessionManager"), \
             patch("targets.TargetManager"), \
             patch("agent.Agent"), \
             patch("agent.AgentSession"), \
             patch("store.EventStore"), \
             patch("store.metrics.MetricCollector"), \
             patch("auth.AuthStore") as MockAuth:
            MockAuth.return_value.count_users.return_value = 1
            import ui.web as web
            return web

    def test_local_fallback_when_redis_unset(self, monkeypatch):
        monkeypatch.delenv("AZIRO_REDIS_URL", raising=False)
        _reset_client()
        web = self._import_web()
        import queue as _queue
        q = _queue.Queue()
        web._monitor_subs["sid-test"] = q
        try:
            web._broadcast_alert({"hello": "world"})
            evt = q.get(timeout=1)
            assert evt == {"hello": "world"}
        finally:
            web._monitor_subs.pop("sid-test", None)

    def test_redis_publish_when_configured(self, monkeypatch):
        # We stub the _ensure_redis_monitor_subscriber to hand back a
        # fake client WITHOUT starting a real subscriber thread — the
        # contract we care about here is that `_broadcast_alert`
        # publishes on the shared channel and does NOT also fan out
        # locally (the subscriber is responsible for that).
        web = self._import_web()
        import queue as _queue
        q = _queue.Queue()
        web._monitor_subs["sid-test"] = q

        published = []
        class _Fake:
            def publish(self, channel, payload):
                published.append((channel, payload))
                return 1

        try:
            with patch.object(web, "_ensure_redis_monitor_subscriber",
                              return_value=_Fake()):
                web._broadcast_alert({"hello": "world"})
            assert len(published) == 1
            channel, payload = published[0]
            assert channel == "aziro:monitor"
            assert json.loads(payload) == {"hello": "world"}
            # Local queue must be empty — delivery goes through the
            # subscriber, not the producer.
            assert q.empty()
        finally:
            web._monitor_subs.pop("sid-test", None)

    def test_redis_publish_fallback_to_local_on_error(self, monkeypatch):
        web = self._import_web()
        import queue as _queue
        q = _queue.Queue()
        web._monitor_subs["sid-test"] = q

        class _Broken:
            def publish(self, *a, **kw):
                raise RuntimeError("redis down")

        try:
            with patch.object(web, "_ensure_redis_monitor_subscriber",
                              return_value=_Broken()):
                web._broadcast_alert({"hello": "world"})
            # Redis blew up, but the local client on *this* worker still
            # gets the alert so the UI isn't silently dark.
            evt = q.get(timeout=1)
            assert evt == {"hello": "world"}
        finally:
            web._monitor_subs.pop("sid-test", None)


# ── 5. /readyz redis probe ──────────────────────────────────────────────────


class TestReadyzRedis:
    @pytest.fixture
    def client(self, monkeypatch):
        sys.modules.pop("ui.web", None)
        with patch("providers.LLMClient"), \
             patch("tools.ToolExecutor"), \
             patch("sessions.SessionManager") as MockSessions, \
             patch("targets.TargetManager") as MockTargets, \
             patch("agent.Agent"), \
             patch("agent.AgentSession"), \
             patch("store.EventStore") as MockStore, \
             patch("store.metrics.MetricCollector"), \
             patch("auth.AuthStore") as MockAuth:
            MockAuth.return_value.count_users.return_value = 1
            MockTargets.return_value.has_local.return_value = True
            MockSessions.return_value.load.return_value = []
            MockStore.return_value._conn.return_value.execute.return_value.fetchone.return_value = (1,)
            MockStore.return_value._engine.dialect.name = "sqlite"
            from ui.web import app
            app.config["TESTING"] = True
            with app.test_client() as c:
                yield c

    def test_redis_check_absent_when_url_unset(self, client, monkeypatch):
        monkeypatch.delenv("AZIRO_REDIS_URL", raising=False)
        _reset_client()
        r = client.get("/api/v1/readyz")
        assert r.status_code == 200
        assert "redis" not in r.get_json()["checks"]

    def test_redis_ok_when_ping_succeeds(self, client, monkeypatch):
        fake, (ep, fp) = _install_fakeredis()
        _reset_client()
        with ep, fp:
            r = client.get("/api/v1/readyz")
        assert r.status_code == 200
        body = r.get_json()
        assert body["checks"]["redis"] == "ok"

    def test_redis_failure_flips_503(self, client, monkeypatch):
        monkeypatch.setenv("AZIRO_REDIS_URL", "redis://bad:1/0")
        _reset_client()
        class _Dead:
            def ping(self):
                raise RuntimeError("conn refused")
        with patch("redis.Redis.from_url", return_value=_Dead()):
            r = client.get("/api/v1/readyz")
        assert r.status_code == 503
        body = r.get_json()
        assert body["status"] == "unavailable"
        assert body["checks"]["redis"].startswith("fail")
