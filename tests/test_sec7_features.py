"""
tests/test_sec7_features.py — SEC-7 feature flags / kill switches.

Three layers:

1. Registry unit tests — precedence (runtime > env > default), unknown-name
   rejection, env parsing, thread-safety of the in-memory override map.

2. Wire-in checks — confirm each flagged path honours the switch:
     * agent loop feeds a placeholder back when `agent_tools` is off,
       rather than executing the command.
     * /api/v1/analyze + /api/v1/analyze/stream return 503.
     * /api/v1/monitor/<tid> POST returns 503.

3. Admin API — GET is open to any authenticated user (so the UI banner
   can render for viewers), POST/DELETE require admin. Toggles are
   audited to the log stream.

The web tests reuse the Phase E1 fresh-app fixture pattern so the module
state under test is a real Flask app, not a partial mock.
"""
import os
import sys
import threading

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch


# ── Registry unit tests (no Flask) ──────────────────────────────────────────

@pytest.fixture
def features(monkeypatch):
    """Fresh features module with a cleared override map and no env vars."""
    for key in list(os.environ):
        if key.startswith("AZIRO_FEATURE_"):
            monkeypatch.delenv(key, raising=False)
    sys.modules.pop("config", None)
    sys.modules.pop("config.features", None)
    from config import features as f
    return f


def test_default_is_enabled(features):
    assert features.is_enabled(features.FEATURE_AUTO_MONITOR) is True
    assert features.is_enabled(features.FEATURE_AGENT_TOOLS) is True
    assert features.is_enabled(features.FEATURE_ANALYZE_ENDPOINT) is True


def test_unknown_flag_returns_false(features):
    # Fail-closed on typos — a caller guarding an expensive path on
    # is_enabled("agnet_tools") should NOT proceed as if the flag is on.
    assert features.is_enabled("nonexistent") is False
    assert features.is_enabled("") is False


def test_env_disables_flag(features, monkeypatch):
    monkeypatch.setenv("AZIRO_FEATURE_AUTO_MONITOR", "0")
    assert features.is_enabled(features.FEATURE_AUTO_MONITOR) is False


@pytest.mark.parametrize("raw", ["0", "false", "FALSE", "No", "off", ""])
def test_env_falsy_variants(features, monkeypatch, raw):
    monkeypatch.setenv("AZIRO_FEATURE_AGENT_TOOLS", raw)
    assert features.is_enabled(features.FEATURE_AGENT_TOOLS) is False


@pytest.mark.parametrize("raw", ["1", "true", "yes", "on", "enabled"])
def test_env_truthy_variants(features, monkeypatch, raw):
    monkeypatch.setenv("AZIRO_FEATURE_AGENT_TOOLS", raw)
    assert features.is_enabled(features.FEATURE_AGENT_TOOLS) is True


def test_runtime_override_beats_env(features, monkeypatch):
    monkeypatch.setenv("AZIRO_FEATURE_AUTO_MONITOR", "0")
    features.set_enabled(features.FEATURE_AUTO_MONITOR, True)
    assert features.is_enabled(features.FEATURE_AUTO_MONITOR) is True


def test_clear_override_falls_back_to_env(features, monkeypatch):
    monkeypatch.setenv("AZIRO_FEATURE_AGENT_TOOLS", "0")
    features.set_enabled(features.FEATURE_AGENT_TOOLS, True)
    assert features.is_enabled(features.FEATURE_AGENT_TOOLS) is True
    features.clear_override(features.FEATURE_AGENT_TOOLS)
    assert features.is_enabled(features.FEATURE_AGENT_TOOLS) is False


def test_set_enabled_rejects_unknown(features):
    with pytest.raises(KeyError):
        features.set_enabled("ghost_feature", True)


def test_list_flags_reports_source(features, monkeypatch):
    monkeypatch.setenv("AZIRO_FEATURE_AUTO_MONITOR", "0")
    features.set_enabled(features.FEATURE_AGENT_TOOLS, False)

    flags = {f["name"]: f for f in features.list_flags()}

    assert flags[features.FEATURE_AUTO_MONITOR]["source"] == "env"
    assert flags[features.FEATURE_AUTO_MONITOR]["enabled"] is False
    assert flags[features.FEATURE_AGENT_TOOLS]["source"] == "runtime"
    assert flags[features.FEATURE_AGENT_TOOLS]["enabled"] is False
    assert flags[features.FEATURE_ANALYZE_ENDPOINT]["source"] == "default"
    assert flags[features.FEATURE_ANALYZE_ENDPOINT]["enabled"] is True


def test_set_enabled_is_threadsafe(features):
    # Hammer the override map from many threads to surface a missing lock.
    # Not a strict proof, but would catch a naive dict mutation that
    # left _overrides in an inconsistent state.
    stop = threading.Event()

    def flipper(name):
        while not stop.is_set():
            features.set_enabled(name, True)
            features.set_enabled(name, False)

    threads = [threading.Thread(target=flipper,
                                args=(features.FEATURE_AGENT_TOOLS,))
               for _ in range(8)]
    for t in threads:
        t.start()
    for _ in range(1000):
        features.is_enabled(features.FEATURE_AGENT_TOOLS)
    stop.set()
    for t in threads:
        t.join(timeout=2)
    # If we reach here without a deadlock or exception, the test passes.


# ── Agent-loop wire-in ──────────────────────────────────────────────────────

class _StubLLM:
    """Returns one tool call on the first step, then a plain answer."""

    def __init__(self):
        self.tool_model = "stub"
        self.answer_model = "stub"
        self.calls = 0

    def chat(self, messages, use_tools=True, user_id=None, session_id=None,
             usage_out=None):
        self.calls += 1
        if isinstance(usage_out, dict):
            usage_out["total_tokens"] = 10
        if self.calls == 1:
            return "", "kubectl get pods", f"tc-{self.calls}"
        return "final answer", None, None

    def chat_stream(self, messages, use_tools=False):
        if False:
            yield ""


class _ShouldNotExecute:
    """ToolExecutor stand-in that fails the test if called."""

    def execute(self, target, command):
        raise AssertionError(
            f"tool execution must be skipped when agent_tools is off, got {command!r}"
        )


class _FakeSession:
    def get(self, tid): return []
    def set(self, tid, msgs): pass
    def trim(self, msgs): return msgs


def test_agent_skips_tool_execution_when_flag_off(monkeypatch):
    monkeypatch.setenv("AZIRO_FEATURE_AGENT_TOOLS", "0")
    monkeypatch.setenv("AZIRO_AGENT_RUN_TOKEN_CAP", "0")
    sys.modules.pop("config", None)
    sys.modules.pop("config.features", None)
    sys.modules.pop("agent", None)
    sys.modules.pop("agent.conversation", None)
    from agent.conversation import Agent

    agent = Agent(_StubLLM(), _ShouldNotExecute())
    events = list(agent._run_internal(
        messages=[], target={}, session=_FakeSession(), target_id="tid",
    ))
    # Loop completed without the ToolExecutor ever being called,
    # and a done event still fired so the client isn't left hanging.
    assert any(e["type"] == "done" for e in events)
    # No cmd event — we short-circuited before yielding it.
    assert not any(e["type"] == "cmd" for e in events)


# ── HTTP endpoint wire-ins ──────────────────────────────────────────────────

def _isolated_data_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    for key in ("AZIRO_API_KEY", "AZIRO_ALLOWED_ORIGINS", "AZIRO_ENABLE_HSTS",
                "AZIRO_PROXY_HOPS", "AZIRO_AUTH_MODE", "AZIRO_SESSION_SECRET",
                "AZIRO_BOOTSTRAP_ADMIN_USER", "AZIRO_BOOTSTRAP_ADMIN_PASSWORD"):
        monkeypatch.delenv(key, raising=False)
    for key in list(os.environ):
        if key.startswith("AZIRO_FEATURE_"):
            monkeypatch.delenv(key, raising=False)


def _reload_web():
    for name in ("ui.web", "auth", "auth.db", "auth.middleware", "auth.routes",
                 "config", "config.features"):
        sys.modules.pop(name, None)
    import ui.web as web
    web.app.config["TESTING"] = True
    return web, web.app.test_client()


@pytest.fixture
def fresh_app(tmp_path, monkeypatch):
    _isolated_data_dir(monkeypatch, tmp_path)
    monkeypatch.setenv("AZIRO_AUTH_MODE", "session")
    monkeypatch.setenv("AZIRO_SESSION_SECRET", "test-secret-please-ignore")
    monkeypatch.setenv("AZIRO_BCRYPT_ROUNDS", "4")
    with patch("providers.LLMClient") as MockLLM, \
         patch("tools.ToolExecutor"), \
         patch("sessions.SessionManager") as MockSessions, \
         patch("targets.TargetManager") as MockTargets, \
         patch("agent.Agent"), \
         patch("agent.AgentSession"), \
         patch("store.EventStore") as MockStore, \
         patch("store.metrics.MetricCollector"):
        MockTargets.return_value.has_local.return_value = True
        MockTargets.return_value.get.return_value = {
            "id": "t1", "name": "x", "type": "kubernetes", "config": {}, "status": "ok",
        }
        MockTargets.return_value.mask_config.return_value = {}
        MockTargets.return_value.load_safe.return_value = []
        MockSessions.return_value.load.return_value = []
        # Budget check reads user_tokens_today — must be an int or the
        # `used >= budget` comparison blows up.
        MockStore.return_value.user_tokens_today.return_value = 0
        MockLLM.return_value.chat.return_value = ("ok", None, None)
        yield _reload_web()


def _login_as(client, web, username, password, role):
    web._auth.create_user(username, password, role=role)
    r = client.post("/api/v1/auth/login",
                    json={"username": username, "password": password})
    assert r.status_code == 200, r.get_json()


def test_analyze_returns_503_when_disabled(fresh_app):
    web, c = fresh_app
    _login_as(c, web, "alice", "correct-horse-battery", "admin")
    # Toggle via admin API so we exercise that path too.
    r = c.post("/api/v1/admin/features/analyze_endpoint",
               json={"enabled": False})
    assert r.status_code == 200

    r = c.post("/api/v1/analyze", json={"prompt": "hi"})
    assert r.status_code == 503
    assert r.get_json()["feature"] == "analyze_endpoint"
    assert r.headers.get("Retry-After") == "60"


def test_analyze_stream_returns_503_when_disabled(fresh_app):
    web, c = fresh_app
    _login_as(c, web, "alice", "correct-horse-battery", "admin")
    c.post("/api/v1/admin/features/analyze_endpoint", json={"enabled": False})
    r = c.post("/api/v1/analyze/stream", json={"prompt": "hi"})
    assert r.status_code == 503


def test_monitor_start_returns_503_when_disabled(fresh_app):
    web, c = fresh_app
    _login_as(c, web, "alice", "correct-horse-battery", "admin")
    c.post("/api/v1/admin/features/auto_monitor", json={"enabled": False})
    r = c.post("/api/v1/monitor/t1")
    assert r.status_code == 503
    assert r.get_json()["feature"] == "auto_monitor"


def test_analyze_works_when_flag_on(fresh_app):
    web, c = fresh_app
    _login_as(c, web, "alice", "correct-horse-battery", "admin")
    # Flag is on by default — request should NOT be short-circuited at the
    # feature gate. We don't care what status the LLM mock returns downstream,
    # only that it isn't the SEC-7 503.
    r = c.post("/api/v1/analyze", json={"prompt": "hi"})
    body = r.get_json() or {}
    assert body.get("feature") != "analyze_endpoint"


# ── Admin API ───────────────────────────────────────────────────────────────

def test_features_list_requires_auth(fresh_app):
    _, c = fresh_app
    r = c.get("/api/v1/admin/features")
    assert r.status_code == 401


def test_features_list_ok_for_viewer(fresh_app):
    web, c = fresh_app
    _login_as(c, web, "viv", "correct-horse-battery", "viewer")
    r = c.get("/api/v1/admin/features")
    assert r.status_code == 200
    names = {f["name"] for f in r.get_json()["features"]}
    assert {"auto_monitor", "agent_tools", "analyze_endpoint"} <= names


def test_features_toggle_rejects_viewer(fresh_app):
    web, c = fresh_app
    _login_as(c, web, "viv", "correct-horse-battery", "viewer")
    r = c.post("/api/v1/admin/features/auto_monitor",
               json={"enabled": False})
    assert r.status_code == 403


def test_features_toggle_rejects_unknown_name(fresh_app):
    web, c = fresh_app
    _login_as(c, web, "alice", "correct-horse-battery", "admin")
    r = c.post("/api/v1/admin/features/no_such_flag",
               json={"enabled": False})
    assert r.status_code == 404


def test_features_toggle_requires_enabled_field(fresh_app):
    web, c = fresh_app
    _login_as(c, web, "alice", "correct-horse-battery", "admin")
    r = c.post("/api/v1/admin/features/auto_monitor", json={})
    assert r.status_code == 400


def test_features_delete_clears_override(fresh_app):
    web, c = fresh_app
    _login_as(c, web, "alice", "correct-horse-battery", "admin")
    c.post("/api/v1/admin/features/agent_tools", json={"enabled": False})
    r = c.delete("/api/v1/admin/features/agent_tools")
    assert r.status_code == 200
    body = r.get_json()
    # Cleared override → falls back to default (True).
    assert body["enabled"] is True
    assert body["source"] == "default"
