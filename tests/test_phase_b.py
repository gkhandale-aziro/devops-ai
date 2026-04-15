"""
Tests for Phase B — in-memory hygiene + input validation.

H-06: AgentSession._sessions must evict by TTL and cap total entries.
M-03: _trim must live in agent.manager only (ui/web.py re-exports it).
M-08: target `name` must be length-capped and allowlisted before injection
      into the agent system prompt.
H-07: LLM transient retry must cap total blocking at ≤ ~10s (2 retries × 3s).
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


# ── H-06 AgentSession eviction ───────────────────────────────────────────────

class TestAgentSessionEviction:
    def _fresh_session(self, ttl=60):
        """Return an AgentSession with a tiny cap for fast tests. TTL is
        large by default so the initial disk-hitting TargetManager.get()
        doesn't evict earlier entries mid-test."""
        import agent.manager as am
        am.MAX_CACHED_SESSIONS = 3
        am.SESSION_TTL_SEC     = ttl
        return am.AgentSession()

    def teardown_method(self):
        # Restore production defaults for other tests.
        import agent.manager as am
        am.MAX_CACHED_SESSIONS = 64
        am.SESSION_TTL_SEC     = 3600

    def test_caches_messages_on_repeat_get(self):
        s = self._fresh_session()
        a = s.get("tid-1")
        b = s.get("tid-1")
        # Same underlying list — cache hit, not rebuilt.
        assert a is b

    def test_size_cap_evicts_oldest(self):
        s = self._fresh_session()  # cap=3
        s.get("t1")
        s.get("t2")
        s.get("t3")
        s.get("t4")  # pushes t1 out
        assert "t1" not in s._sessions
        assert "t4" in s._sessions
        assert len(s._sessions) == 3

    def test_ttl_evicts_stale_entries(self):
        s = self._fresh_session(ttl=1)
        s.get("old")
        time.sleep(1.1)
        s.get("new")   # triggers _evict()
        assert "old" not in s._sessions
        assert "new" in s._sessions

    def test_access_refreshes_lru_order(self):
        s = self._fresh_session()  # cap=3
        s.get("t1")
        s.get("t2")
        s.get("t3")
        s.get("t1")   # re-access t1 → now most-recent
        s.get("t4")   # should evict t2 (oldest), not t1
        assert "t1" in s._sessions
        assert "t2" not in s._sessions


# ── M-03 _trim single source of truth ────────────────────────────────────────

class TestTrimDedupe:
    def test_web_reexports_trim_from_agent_manager(self):
        from ui.web import _trim as web_trim, MAX_HISTORY as web_max
        from agent.manager import _trim as agent_trim, MAX_HISTORY as agent_max
        assert web_trim is agent_trim
        assert web_max == agent_max

    def test_trim_keeps_all_system_messages(self):
        from agent.manager import _trim, MAX_HISTORY
        msgs = (
            [{"role": "system", "content": f"sys-{i}"} for i in range(2)]
            + [{"role": "user", "content": f"u-{i}"} for i in range(MAX_HISTORY + 5)]
        )
        out = _trim(msgs)
        # All 2 system messages preserved.
        assert sum(1 for m in out if m["role"] == "system") == 2
        # History capped to MAX_HISTORY.
        assert sum(1 for m in out if m["role"] != "system") == MAX_HISTORY


# ── M-08 target name validation ──────────────────────────────────────────────

class TestTargetNameValidation:
    def test_safe_name_regex_accepts_typical(self):
        from ui.web import _SAFE_TARGET_NAME_RE
        for n in ["prod", "staging-01", "my cluster", "app.v2", "web_03", "A1"]:
            assert _SAFE_TARGET_NAME_RE.match(n), f"rejected safe name: {n!r}"

    def test_safe_name_regex_rejects_injection(self):
        from ui.web import _SAFE_TARGET_NAME_RE
        # Shell / markdown / control-char metacharacters. Plain-English
        # prompt injection ("Ignore previous instructions") cannot be
        # blocked by regex — the 64-char length cap mitigates multi-line
        # payloads instead.
        bad = [
            "# markdown",
            "`whoami`",
            "$(id)",
            "a;b",
            "a|b",
            "a&&b",
            "-leading-hyphen",
            "",
            "\n",
            "name\nline2",
            "tab\there",
            "ctrl\x00char",
        ]
        for n in bad:
            assert not _SAFE_TARGET_NAME_RE.match(n), f"accepted unsafe name: {n!r}"

    def test_validator_rejects_empty(self):
        from ui.web import app, _validate_target_name
        with app.app_context():
            result = _validate_target_name("")
            assert result is not None
            _, status = result
            assert status == 400

    def test_validator_rejects_too_long(self):
        from ui.web import app, _validate_target_name, _MAX_TARGET_NAME_LEN
        with app.app_context():
            result = _validate_target_name("a" * (_MAX_TARGET_NAME_LEN + 1))
            assert result is not None
            _, status = result
            assert status == 400

    def test_validator_accepts_safe(self):
        from ui.web import app, _validate_target_name
        with app.app_context():
            assert _validate_target_name("prod-k8s") is None
            assert _validate_target_name("my cluster 01") is None


# ── M-08 end-to-end on /api/v1/targets ───────────────────────────────────────

from unittest.mock import patch


@pytest.fixture
def client():
    with patch("ui.web._targets") as mock_targets, \
         patch("ui.web._tools"), \
         patch("ui.web._auto_register_localhost"):
        mock_targets.get.return_value = None
        mock_targets.load_safe.return_value = []
        from ui.web import app
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c, mock_targets


class TestApiTargetsNameInjection:
    def test_add_rejects_prompt_injection_name(self, client):
        c, _ = client
        r = c.post("/api/v1/targets",
                   json={"name": "`id`", "type": "kubernetes", "config": {}},
                   content_type="application/json")
        assert r.status_code == 400
        assert b"invalid name" in r.data

    def test_add_rejects_oversize_name(self, client):
        c, _ = client
        r = c.post("/api/v1/targets",
                   json={"name": "a" * 200, "type": "kubernetes", "config": {}},
                   content_type="application/json")
        assert r.status_code == 400

    def test_add_accepts_safe_name(self, client):
        c, mock_targets = client
        mock_targets.add.return_value = {"id": "t1", "name": "prod", "type": "kubernetes",
                                         "config": {}, "status": "unknown"}
        mock_targets.mask_config.return_value = {}
        r = c.post("/api/v1/targets",
                   json={"name": "prod-k8s", "type": "kubernetes", "config": {}},
                   content_type="application/json")
        assert r.status_code == 200


# ── H-07 retry blocking cap ──────────────────────────────────────────────────

class TestLLMRetryBlockingCap:
    """Verify the transient retry window is bounded. Gap analysis called
    out a 90s worst case (10+20+60); the current code is 2 × 3s = 6s."""

    def test_retry_constants_bounded(self):
        from providers.client import TRANSIENT_RETRIES, TRANSIENT_DELAY
        # Total blocking time for transient retries must stay ≤ 10s so a
        # flaky upstream cannot exhaust the Flask thread pool.
        assert TRANSIENT_RETRIES * TRANSIENT_DELAY <= 10
