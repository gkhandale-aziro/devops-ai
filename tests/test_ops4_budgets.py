"""
tests/test_ops4_budgets.py — OPS-4 per-user LLM token budgets + run-token cap.

Three layers are exercised:

1. Store — `record_llm_usage` persists per-call rows; `user_tokens_today`
   sums tokens since local midnight. Anonymous (empty user_id) writes are
   no-ops so system calls like title generation don't skew the ledger.

2. Provider — `LLMClient._chat_once` populates the `usage_out` dict passed
   by the caller AND invokes the wired `usage_sink` callback. The sink
   pattern keeps providers/ free of store/ imports, so tests exercise it
   without importing the web layer.

3. Agent loop — a runaway tool-calling loop is cut off once cumulative
   tokens cross AZIRO_AGENT_RUN_TOKEN_CAP. MAX_STEPS alone doesn't bound
   cost because a single step can blow through a daily budget.

The provider and agent tests stub the remote API with a fake response
object so they don't hit the network or require Ollama.
"""
import os
import sys
import datetime
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


# ── Store fixture ────────────────────────────────────────────────────────────

@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    sys.modules.pop("store", None)
    sys.modules.pop("store.db", None)
    from store.db import EventStore
    return EventStore(db_file=str(tmp_path / "aziro.db"))


# ── Store tests ──────────────────────────────────────────────────────────────

def test_record_llm_usage_persists_total(store):
    store.record_llm_usage("alice", "gemini/gemini-2.5-flash", 100, 250, "sess-1")
    assert store.user_tokens_today("alice") == 350


def test_record_llm_usage_sums_across_calls(store):
    store.record_llm_usage("alice", "m", 10, 20)
    store.record_llm_usage("alice", "m", 30, 40)
    store.record_llm_usage("alice", "m", 5, 5)
    assert store.user_tokens_today("alice") == 110


def test_record_llm_usage_isolates_users(store):
    store.record_llm_usage("alice", "m", 100, 100)
    store.record_llm_usage("bob",   "m", 999, 999)
    assert store.user_tokens_today("alice") == 200
    assert store.user_tokens_today("bob")   == 1998


def test_record_llm_usage_empty_user_is_noop(store):
    # System calls (title generation, prefetches) pass "" as user_id;
    # they must not land as rows because they'd show up against no one.
    store.record_llm_usage("", "m", 500, 500)
    assert store.user_tokens_today("") == 0
    with store._conn() as c:
        row = c.execute("SELECT COUNT(*) AS n FROM llm_usage").fetchone()
    assert row["n"] == 0


def test_record_llm_usage_swallows_errors(store, monkeypatch):
    # A DB blip must not crash the hot path. We simulate by closing the
    # underlying connection factory so any INSERT raises.
    def _broken_conn():
        raise RuntimeError("db gone")

    monkeypatch.setattr(store, "_conn", _broken_conn)
    # Must not raise:
    store.record_llm_usage("alice", "m", 10, 10)


def test_user_tokens_today_ignores_yesterday(store):
    # Seed a row dated yesterday by writing directly through the internal
    # connection. user_tokens_today's cutoff is today's local midnight.
    yesterday = (datetime.datetime.now() - datetime.timedelta(days=1)).isoformat(
        timespec="seconds"
    )
    with store._conn() as c:
        c.execute(
            """INSERT INTO llm_usage
               (timestamp, user_id, model, prompt_tokens,
                completion_tokens, total_tokens, session_id)
               VALUES (?,?,?,?,?,?,?)""",
            (yesterday, "alice", "m", 500, 500, 1000, ""),
        )
    # Today's number excludes yesterday's 1000.
    assert store.user_tokens_today("alice") == 0
    store.record_llm_usage("alice", "m", 10, 10)
    assert store.user_tokens_today("alice") == 20


# ── Provider usage-sink tests ────────────────────────────────────────────────

def _fake_openai_response(prompt=10, completion=15):
    """Return a SimpleNamespace shaped like an OpenAI ChatCompletion."""
    message = types.SimpleNamespace(content="ok", tool_calls=None)
    choice = types.SimpleNamespace(message=message)
    usage = types.SimpleNamespace(
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=prompt + completion,
    )
    return types.SimpleNamespace(choices=[choice], usage=usage)


@pytest.fixture
def llm(monkeypatch):
    """Return an LLMClient with a stubbed _call_api that returns fake usage."""
    # Prevent network discovery during __init__.
    monkeypatch.setenv("AI_MODEL", "ollama/stub-model")
    monkeypatch.setenv("TOOL_MODEL", "ollama/stub-model")
    monkeypatch.setenv("ANSWER_MODEL", "ollama/stub-model")
    sys.modules.pop("providers", None)
    sys.modules.pop("providers.client", None)
    from providers import client as pc

    monkeypatch.setattr(
        pc, "_call_api",
        lambda *a, **kw: _fake_openai_response(prompt=7, completion=11),
    )
    return pc.LLMClient()


def test_chat_populates_usage_out(llm):
    usage = {}
    llm.chat([{"role": "user", "content": "hi"}], use_tools=False,
             user_id="alice", usage_out=usage)
    assert usage["prompt_tokens"] == 7
    assert usage["completion_tokens"] == 11
    assert usage["total_tokens"] == 18


def test_chat_calls_usage_sink(llm):
    calls = []
    llm.usage_sink = lambda uid, model, pt, ct, sid: calls.append(
        (uid, model, pt, ct, sid)
    )
    llm.chat([{"role": "user", "content": "hi"}], use_tools=False,
             user_id="alice", session_id="sess-42")
    assert len(calls) == 1
    uid, _, pt, ct, sid = calls[0]
    assert uid == "alice"
    assert pt == 7 and ct == 11
    assert sid == "sess-42"


def test_chat_skips_sink_when_no_user_id(llm):
    calls = []
    llm.usage_sink = lambda *a, **kw: calls.append(a)
    llm.chat([{"role": "user", "content": "hi"}], use_tools=False)
    # Anonymous system call — no user to attribute to, sink stays silent.
    assert calls == []


def test_chat_sink_error_does_not_break_call(llm):
    def _broken_sink(*a, **kw):
        raise RuntimeError("boom")

    llm.usage_sink = _broken_sink
    # Must succeed even though sink raises.
    reply, _cmd, _tc_id = llm.chat(
        [{"role": "user", "content": "hi"}], use_tools=False,
        user_id="alice",
    )
    assert reply == "ok"


# ── Agent circuit-breaker tests ──────────────────────────────────────────────

class _FakeLLM:
    """Minimal LLMClient stand-in for the agent loop.

    Each chat() returns a command so the loop keeps invoking tools, and
    reports `tokens_per_call` in usage_out so we can drive it over the cap.
    """

    def __init__(self, tokens_per_call: int):
        self.tool_model = "ollama/stub"
        self.answer_model = "ollama/stub"
        self._tokens = tokens_per_call
        self.calls = 0

    def chat(self, messages, use_tools=True, user_id=None, session_id=None,
             usage_out=None):
        self.calls += 1
        if isinstance(usage_out, dict):
            usage_out["prompt_tokens"] = self._tokens // 2
            usage_out["completion_tokens"] = self._tokens - self._tokens // 2
            usage_out["total_tokens"] = self._tokens
        # Return a tool call so the loop keeps going.
        return "", f"echo step-{self.calls}", f"tc-{self.calls}"

    def chat_stream(self, messages, use_tools=False):
        if False:
            yield ""


class _FakeTools:
    def execute(self, target, command):
        return "stdout\n"


class _FakeSession:
    def get(self, tid):
        return []

    def set(self, tid, msgs):
        pass

    def trim(self, msgs):
        return msgs


def test_agent_loop_halts_on_token_cap(monkeypatch):
    # 30k per step × 2 steps = 60k, which should trip the 50k default cap
    # on the second step.
    monkeypatch.setenv("AZIRO_AGENT_RUN_TOKEN_CAP", "50000")
    sys.modules.pop("agent", None)
    sys.modules.pop("agent.conversation", None)
    from agent.conversation import Agent

    llm = _FakeLLM(tokens_per_call=30_000)
    agent = Agent(llm, _FakeTools())

    events = list(agent._run_internal(
        messages=[], target={}, session=_FakeSession(), target_id="tid",
        user_id="alice", session_db_id="sess-1",
    ))

    # Should have aborted with an error on the second chat() call.
    errors = [e for e in events if e["type"] == "error"]
    assert errors, f"expected circuit-breaker error, got {events}"
    assert "token cap" in errors[0]["msg"].lower()
    assert llm.calls == 2


def test_agent_loop_cap_disabled_when_zero(monkeypatch):
    monkeypatch.setenv("AZIRO_AGENT_RUN_TOKEN_CAP", "0")
    sys.modules.pop("agent", None)
    sys.modules.pop("agent.conversation", None)
    from agent.conversation import Agent, MAX_STEPS

    llm = _FakeLLM(tokens_per_call=1_000_000)
    agent = Agent(llm, _FakeTools())

    events = list(agent._run_internal(
        messages=[], target={}, session=_FakeSession(), target_id="tid",
    ))

    # With the cap disabled, the loop runs MAX_STEPS and falls through to
    # the final streaming recap (no circuit-breaker error event).
    errors = [e for e in events if e["type"] == "error"]
    assert errors == []
    assert llm.calls == MAX_STEPS


def test_agent_loop_threads_user_id_to_llm(monkeypatch):
    monkeypatch.setenv("AZIRO_AGENT_RUN_TOKEN_CAP", "0")
    sys.modules.pop("agent", None)
    sys.modules.pop("agent.conversation", None)
    from agent.conversation import Agent

    seen = []

    class _CaptureLLM(_FakeLLM):
        def chat(self, messages, use_tools=True, user_id=None,
                 session_id=None, usage_out=None):
            seen.append((user_id, session_id))
            return "final answer", None, None  # terminate after one step

    llm = _CaptureLLM(tokens_per_call=10)
    agent = Agent(llm, _FakeTools())
    list(agent._run_internal(
        messages=[], target={}, session=_FakeSession(), target_id="tid",
        user_id="alice", session_db_id="sess-99",
    ))
    assert seen == [("alice", "sess-99")]
