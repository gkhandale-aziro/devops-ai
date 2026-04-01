"""
Tests for agent/manager.py — AgentSession per-target message history.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from unittest.mock import patch
from agent.manager import AgentSession


class TestAgentSession:
    def setup_method(self):
        self.session = AgentSession()

    def test_get_creates_new_session(self):
        with patch("agent.manager.get_target", return_value={"name": "myserver", "type": "ssh"}):
            msgs = self.session.get("tid-1")
        assert len(msgs) == 1
        assert msgs[0]["role"] == "system"
        assert "myserver" in msgs[0]["content"]

    def test_get_returns_same_session(self):
        with patch("agent.manager.get_target", return_value={"name": "myserver", "type": "ssh"}):
            msgs1 = self.session.get("tid-1")
            msgs2 = self.session.get("tid-1")
        assert msgs1 is msgs2

    def test_set_updates_session(self):
        with patch("agent.manager.get_target", return_value={"name": "srv", "type": "ssh"}):
            self.session.get("tid-2")
        new_msgs = [{"role": "system", "content": "hello"}, {"role": "user", "content": "test"}]
        self.session.set("tid-2", new_msgs)
        assert self.session.get("tid-2") == new_msgs

    def test_remove_clears_session(self):
        with patch("agent.manager.get_target", return_value={"name": "srv", "type": "ssh"}):
            self.session.get("tid-3")
        self.session.remove("tid-3")
        # After removal, get creates fresh session
        with patch("agent.manager.get_target", return_value={"name": "srv", "type": "ssh"}):
            msgs = self.session.get("tid-3")
        assert len(msgs) == 1

    def test_trim_keeps_system_and_last_20(self):
        system  = {"role": "system", "content": "sys"}
        history = [{"role": "user", "content": str(i)} for i in range(30)]
        msgs    = [system] + history
        trimmed = self.session.trim(msgs)
        assert trimmed[0]["role"] == "system"
        assert len(trimmed) == 21  # 1 system + 20 history

    def test_trim_short_history_unchanged(self):
        msgs = [
            {"role": "system",    "content": "sys"},
            {"role": "user",      "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]
        trimmed = self.session.trim(msgs)
        assert len(trimmed) == 3

    def test_unknown_target_uses_defaults(self):
        with patch("agent.manager.get_target", return_value=None):
            msgs = self.session.get("tid-unknown")
        assert msgs[0]["role"] == "system"
        assert "server" in msgs[0]["content"]
