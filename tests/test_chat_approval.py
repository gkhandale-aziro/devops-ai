"""
tests/test_chat_approval.py — human-in-the-loop approval gate for the
target-scoped chat agent.

Coverage:

1. Registry primitives in ui/web.py — register / deliver / unregister,
   behaviour on unknown ids, one-shot semantics (second deliver is a
   no-op once the queue is consumed).

2. Agent.run() wire-in — when on_confirm is passed and the model
   proposes a destructive command, the SSE stream yields an
   `await_approval` event carrying an approval_id + cmd, pauses for
   the decision, then yields `approval_decision`. Approval lets the
   tool execute; denial skips it; timeout is treated as denial so the
   stream never hangs.

3. POST /api/v1/chat/approvals/<id> — admin-gated, validates decision,
   404s on unknown ids, delivers approve/deny to a waiting queue so
   the blocked SSE stream can unblock.

We deliberately stub LLM + ToolExecutor here — the agent loop wiring
is what this file is about, not model behaviour.
"""
from __future__ import annotations

import os
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch


# ── Shared stubs ──────────────────────────────────────────────────────────────

class _DestructiveOnceLLM:
    """Yields one destructive tool call on step 1, a plain answer on step 2."""

    def __init__(self, cmd="kubectl delete pod foo -n default"):
        self.tool_model = "stub"
        self.answer_model = "stub"
        self.calls = 0
        self._cmd = cmd

    def chat(self, messages, use_tools=True, user_id=None, session_id=None,
             usage_out=None):
        self.calls += 1
        if isinstance(usage_out, dict):
            usage_out["total_tokens"] = 5
        if self.calls == 1:
            return "", self._cmd, f"tc-{self.calls}"
        return "ok, done", None, None

    def chat_stream(self, messages, use_tools=False):
        if False:
            yield ""


class _RecordingExecutor:
    def __init__(self):
        self.calls = []

    def execute(self, target, command):
        self.calls.append(command)
        return "pod deleted"


class _RejectingExecutor:
    def execute(self, target, command):
        raise AssertionError(
            f"executor must not run destructive cmd without approval: {command!r}"
        )


class _FakeSession:
    def get(self, tid): return []
    def set(self, tid, msgs): pass
    def trim(self, msgs): return msgs


def _fresh_agent_module(monkeypatch):
    # SEC-7: keep agent_tools ON for these tests — we're exercising the
    # approval branch, not the kill switch. monkeypatch auto-restores the
    # env on teardown so test order can't leak into the SEC-7 kill-switch
    # tests that care whether AZIRO_FEATURE_AGENT_TOOLS is set.
    monkeypatch.delenv("AZIRO_FEATURE_AGENT_TOOLS", raising=False)
    monkeypatch.setenv("AZIRO_AGENT_RUN_TOKEN_CAP", "0")
    sys.modules.pop("config", None)
    sys.modules.pop("config.features", None)
    sys.modules.pop("agent", None)
    sys.modules.pop("agent.conversation", None)
    from agent.conversation import Agent
    return Agent


# ── 1. Registry primitives ────────────────────────────────────────────────────

class TestApprovalRegistry:
    def _fresh_web(self, monkeypatch, tmp_path):
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
        for k in ("AZIRO_API_KEY", "AZIRO_AUTH_MODE", "AZIRO_SESSION_SECRET"):
            monkeypatch.delenv(k, raising=False)
        for m in ("ui.web", "store", "store.db", "store.metrics",
                  "sessions", "sessions.manager",
                  "targets", "targets.manager",
                  "auth", "auth.db", "auth.middleware", "auth.routes"):
            sys.modules.pop(m, None)
        import ui.web as web
        web.app.config["TESTING"] = True
        return web

    def test_register_returns_unique_id_and_queue(self, monkeypatch, tmp_path):
        web = self._fresh_web(monkeypatch, tmp_path)
        a1, q1 = web._register_approval()
        a2, q2 = web._register_approval()
        assert a1 != a2
        assert q1 is not q2
        # Clean up so we don't leak between tests.
        web._unregister_approval(a1)
        web._unregister_approval(a2)

    def test_deliver_unblocks_waiting_consumer(self, monkeypatch, tmp_path):
        web = self._fresh_web(monkeypatch, tmp_path)
        approval_id, q = web._register_approval()

        result = {}
        def wait():
            result["approved"] = q.get(timeout=2)

        t = threading.Thread(target=wait)
        t.start()
        # Small sleep so the consumer is definitely parked on get() before
        # we deliver — otherwise we'd race put vs get setup.
        time.sleep(0.05)
        assert web._deliver_approval(approval_id, True) is True
        t.join(timeout=2)
        assert result.get("approved") is True
        web._unregister_approval(approval_id)

    def test_deliver_unknown_id_returns_false(self, monkeypatch, tmp_path):
        web = self._fresh_web(monkeypatch, tmp_path)
        assert web._deliver_approval("does-not-exist", True) is False

    def test_second_deliver_is_noop(self, monkeypatch, tmp_path):
        # Queue has maxsize=1; once a decision is enqueued and consumed,
        # a second put to the same id with the queue still registered
        # should succeed, but a second put *while* the first is still in
        # the queue must not throw. Our helper uses put_nowait and swallows
        # Queue.Full, so this is the test for that.
        web = self._fresh_web(monkeypatch, tmp_path)
        approval_id, _ = web._register_approval()
        assert web._deliver_approval(approval_id, True) is True
        # Second put without a consumer: queue is full, should return False.
        assert web._deliver_approval(approval_id, False) is False
        web._unregister_approval(approval_id)


# ── 2. Agent.run() wire-in ────────────────────────────────────────────────────

class TestAgentApprovalFlow:
    """Exercise the SSE bridge — Agent.run() must yield await_approval,
    wait for the wait_fn() return value, then yield approval_decision.
    Approval runs the executor; denial skips it; timeout acts like denial.
    """

    def _collect_sse(self, gen):
        """Drain an SSE generator into a list of (kind, payload) tuples.
        `kind` is one of the top-level keys we emit (status, await_approval,
        approval_decision, cmd, tool_start, tool_end, t, error, suggestions,
        [DONE])."""
        import json as _json
        out = []
        for chunk in gen:
            if not chunk.startswith("data: "):
                continue
            body = chunk[len("data: "):].rstrip("\n")
            if body == "[DONE]":
                out.append(("DONE", None))
                continue
            try:
                obj = _json.loads(body)
            except _json.JSONDecodeError:
                continue
            for k, v in obj.items():
                out.append((k, v))
        return out

    def test_approval_allows_command_to_execute(self, monkeypatch):
        Agent = _fresh_agent_module(monkeypatch)
        llm = _DestructiveOnceLLM()
        execu = _RecordingExecutor()
        agent = Agent(llm, execu)

        captured = {}

        def on_confirm(cmd):
            captured["cmd"] = cmd
            # Return a wait_fn that approves immediately.
            return "approval-xyz", (lambda: True)

        events = self._collect_sse(agent.run(
            messages=[{"role": "user", "content": "delete pod foo"}],
            target={}, session=_FakeSession(), target_id="t1",
            on_confirm=on_confirm,
        ))

        kinds = [k for k, _ in events]
        assert "await_approval" in kinds
        assert "approval_decision" in kinds
        # The SSE decision event reports the approved outcome.
        decision = next(v for k, v in events if k == "approval_decision")
        assert decision["decision"] == "approved"
        assert decision["approval_id"] == "approval-xyz"
        # Executor actually ran the destructive command — approval opens the gate.
        assert execu.calls == ["kubectl delete pod foo -n default"]
        assert captured["cmd"] == "kubectl delete pod foo -n default"

    def test_denial_skips_command_execution(self, monkeypatch):
        Agent = _fresh_agent_module(monkeypatch)
        llm = _DestructiveOnceLLM()
        execu = _RejectingExecutor()  # will AssertionError if ever called
        agent = Agent(llm, execu)

        def on_confirm(cmd):
            return "deny-id", (lambda: False)

        events = self._collect_sse(agent.run(
            messages=[{"role": "user", "content": "delete pod foo"}],
            target={}, session=_FakeSession(), target_id="t1",
            on_confirm=on_confirm,
        ))
        decision = next(v for k, v in events if k == "approval_decision")
        assert decision["decision"] == "denied"
        # No cmd events — executor never ran.
        assert not any(k == "cmd" for k, _ in events)

    def test_timeout_is_treated_as_denial(self, monkeypatch):
        Agent = _fresh_agent_module(monkeypatch)
        llm = _DestructiveOnceLLM()
        execu = _RejectingExecutor()
        agent = Agent(llm, execu)

        def on_confirm(cmd):
            return "timeout-id", (lambda: None)  # None = timeout

        events = self._collect_sse(agent.run(
            messages=[{"role": "user", "content": "delete pod foo"}],
            target={}, session=_FakeSession(), target_id="t1",
            on_confirm=on_confirm,
        ))
        decision = next(v for k, v in events if k == "approval_decision")
        assert decision["decision"] == "timeout"
        # Timeout must skip the command — otherwise a slow operator's
        # inaction would silently greenlight destructive verbs.
        assert not any(k == "cmd" for k, _ in events)

    def test_no_on_confirm_keeps_legacy_auto_proceed(self, monkeypatch):
        # Regression guard: callers that don't pass on_confirm (CLI, older
        # tests) should see the original auto-proceed behaviour — no
        # await_approval events, command runs immediately.
        Agent = _fresh_agent_module(monkeypatch)
        llm = _DestructiveOnceLLM()
        execu = _RecordingExecutor()
        agent = Agent(llm, execu)

        events = self._collect_sse(agent.run(
            messages=[{"role": "user", "content": "delete pod foo"}],
            target={}, session=_FakeSession(), target_id="t1",
        ))
        assert not any(k == "await_approval" for k, _ in events)
        assert execu.calls == ["kubectl delete pod foo -n default"]


# ── 3. POST /api/v1/chat/approvals/<id> endpoint ─────────────────────────────

def _reload_web():
    sys.modules.pop("ui.web", None)
    sys.modules.pop("auth", None)
    sys.modules.pop("auth.db", None)
    sys.modules.pop("auth.middleware", None)
    sys.modules.pop("auth.routes", None)
    import ui.web as web
    web.app.config["TESTING"] = True
    return web, web.app.test_client()


def _isolated_data_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    for key in ("AZIRO_API_KEY", "AZIRO_ALLOWED_ORIGINS", "AZIRO_ENABLE_HSTS",
                "AZIRO_AUTH_MODE", "AZIRO_SESSION_SECRET",
                "AZIRO_BOOTSTRAP_ADMIN_USER", "AZIRO_BOOTSTRAP_ADMIN_PASSWORD"):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture
def session_app(tmp_path, monkeypatch):
    _isolated_data_dir(monkeypatch, tmp_path)
    monkeypatch.setenv("AZIRO_AUTH_MODE", "session")
    monkeypatch.setenv("AZIRO_SESSION_SECRET", "test-secret-please-ignore")
    monkeypatch.setenv("AZIRO_BCRYPT_ROUNDS", "4")  # fast bcrypt in CI
    with patch("providers.LLMClient"), \
         patch("tools.ToolExecutor"), \
         patch("sessions.SessionManager") as MockSessions, \
         patch("targets.TargetManager") as MockTargets, \
         patch("agent.Agent"), \
         patch("agent.AgentSession"), \
         patch("store.EventStore"), \
         patch("store.metrics.MetricCollector"):
        MockTargets.return_value.has_local.return_value = True
        MockTargets.return_value.load_safe.return_value = []
        MockSessions.return_value.load.return_value = []
        yield _reload_web()


def _login(web, c, username, password, role):
    web._auth.create_user(username, password, role=role)
    r = c.post("/api/v1/auth/login",
               json={"username": username, "password": password})
    assert r.status_code == 200, r.get_json()


class TestApprovalEndpoint:
    def test_rejects_invalid_decision(self, session_app):
        web, c = session_app
        _login(web, c, "alice", "correct-horse-battery", "admin")
        r = c.post("/api/v1/chat/approvals/anything",
                   json={"decision": "maybe"})
        assert r.status_code == 400
        assert "decision" in r.get_json()["error"]

    def test_unknown_id_returns_404(self, session_app):
        web, c = session_app
        _login(web, c, "alice", "correct-horse-battery", "admin")
        r = c.post("/api/v1/chat/approvals/does-not-exist",
                   json={"decision": "approve"})
        assert r.status_code == 404

    def test_viewer_cannot_approve(self, session_app):
        web, c = session_app
        _login(web, c, "bob", "correct-horse-battery", "viewer")
        # Pre-register so the 404 path isn't what gates us — this must
        # fail on role, not on id lookup.
        approval_id, _ = web._register_approval()
        try:
            r = c.post(f"/api/v1/chat/approvals/{approval_id}",
                       json={"decision": "approve"})
            assert r.status_code == 403
        finally:
            web._unregister_approval(approval_id)

    def test_approve_delivers_to_waiting_queue(self, session_app):
        web, c = session_app
        _login(web, c, "alice", "correct-horse-battery", "admin")
        approval_id, q = web._register_approval()

        result = {}
        def wait():
            result["approved"] = q.get(timeout=2)
        t = threading.Thread(target=wait)
        t.start()
        time.sleep(0.05)

        r = c.post(f"/api/v1/chat/approvals/{approval_id}",
                   json={"decision": "approve"})
        assert r.status_code == 200
        assert r.get_json() == {"ok": True, "approved": True}

        t.join(timeout=2)
        assert result.get("approved") is True

    def test_deny_delivers_false_to_queue(self, session_app):
        web, c = session_app
        _login(web, c, "alice", "correct-horse-battery", "admin")
        approval_id, q = web._register_approval()

        result = {}
        def wait():
            result["approved"] = q.get(timeout=2)
        t = threading.Thread(target=wait)
        t.start()
        time.sleep(0.05)

        r = c.post(f"/api/v1/chat/approvals/{approval_id}",
                   json={"decision": "deny"})
        assert r.status_code == 200
        assert r.get_json() == {"ok": True, "approved": False}

        t.join(timeout=2)
        assert result.get("approved") is False
