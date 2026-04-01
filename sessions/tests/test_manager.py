"""
Tests for sessions/manager.py — ChatGPT-style session CRUD.
"""
import sys, os, json, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import pytest
from unittest.mock import patch


class TestSessionManager:
    def setup_method(self):
        # Point sessions file to a temp file for each test
        self.tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w")
        self.tmp.write("[]")
        self.tmp.close()

        import sessions.manager as m
        m.SESSIONS_FILE = self.tmp.name
        m._messages = {}
        self.m = m

    def teardown_method(self):
        os.unlink(self.tmp.name)

    def test_create_session_returns_id(self):
        s = self.m.create_session("My Chat")
        assert "id" in s
        assert s["title"] == "My Chat"

    def test_load_sessions_returns_created(self):
        self.m.create_session("Test")
        sessions = self.m.load_sessions()
        assert len(sessions) == 1
        assert sessions[0]["title"] == "Test"

    def test_delete_session_removes_it(self):
        s = self.m.create_session("ToDelete")
        self.m.delete_session(s["id"])
        sessions = self.m.load_sessions()
        assert all(x["id"] != s["id"] for x in sessions)

    def test_get_session_messages_default_system(self):
        s = self.m.create_session()
        msgs = self.m.get_session_messages(s["id"])
        assert msgs[0]["role"] == "system"
        assert "Aziro Ops" in msgs[0]["content"]

    def test_set_session_messages(self):
        s   = self.m.create_session()
        new = [{"role": "system", "content": "x"}, {"role": "user", "content": "hi"}]
        self.m.set_session_messages(s["id"], new)
        assert self.m.get_session_messages(s["id"]) == new

    def test_update_session_title_from_new_chat(self):
        s = self.m.create_session("New Chat")
        self.m.update_session_title(s["id"], "Why is my pod crashing?")
        sessions = self.m.load_sessions()
        updated = next(x for x in sessions if x["id"] == s["id"])
        assert updated["title"] == "Why is my pod crashing?"

    def test_update_session_title_truncated(self):
        s     = self.m.create_session("New Chat")
        title = "a" * 60
        self.m.update_session_title(s["id"], title)
        sessions = self.m.load_sessions()
        updated  = next(x for x in sessions if x["id"] == s["id"])
        assert updated["title"].endswith("...")
        assert len(updated["title"]) <= 53

    def test_update_session_title_skips_non_new(self):
        s = self.m.create_session("My Custom Title")
        self.m.update_session_title(s["id"], "Something else")
        sessions = self.m.load_sessions()
        updated  = next(x for x in sessions if x["id"] == s["id"])
        assert updated["title"] == "My Custom Title"

    def test_multiple_sessions_ordered_newest_first(self):
        s1 = self.m.create_session("First")
        s2 = self.m.create_session("Second")
        sessions = self.m.load_sessions()
        assert sessions[0]["id"] == s2["id"]
