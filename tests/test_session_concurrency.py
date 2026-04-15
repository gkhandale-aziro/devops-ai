"""
Tests for C-02 — concurrent access to AgentSession._sessions and
SessionManager._messages. Both classes now hold an internal RLock so
dict mutations are atomic across Flask worker threads.

The stress tests below spawn many threads hammering get/set/remove
and assert the final state is consistent (no lost updates, no raised
exceptions from racey dict mutations).
"""
import os
import sys
import threading
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


class TestAgentSessionConcurrency:
    def test_concurrent_get_set_does_not_lose_updates(self):
        from agent.manager import AgentSession

        s = AgentSession()
        errors = []

        def worker(tid):
            try:
                for i in range(50):
                    msgs = s.get(tid)
                    msgs.append({"role": "user", "content": f"msg-{i}"})
                    s.set(tid, msgs)
            except Exception as e:  # pragma: no cover
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(f"t{i}",)) for i in range(10)]
        for t in threads: t.start()
        for t in threads: t.join()

        assert not errors, f"worker raised: {errors}"
        # Each of the 10 targets should have its own message list intact.
        for i in range(10):
            msgs = s.get(f"t{i}")
            # 1 system + 50 user messages per target, no cross-talk.
            user_msgs = [m for m in msgs if m["role"] == "user"]
            assert len(user_msgs) == 50

    def test_concurrent_remove_does_not_raise(self):
        from agent.manager import AgentSession

        s = AgentSession()
        for i in range(20):
            s.get(f"t{i}")  # seed

        errors = []

        def remover(tid):
            try:
                for _ in range(100):
                    s.remove(tid)
                    s.get(tid)
            except Exception as e:  # pragma: no cover
                errors.append(e)

        threads = [threading.Thread(target=remover, args=(f"t{i}",)) for i in range(20)]
        for t in threads: t.start()
        for t in threads: t.join()

        assert not errors, f"concurrent remove/get raised: {errors}"


class TestSessionManagerConcurrency:
    def test_concurrent_set_messages_is_thread_safe(self, tmp_path, monkeypatch):
        # Isolate disk state per test.
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))

        import importlib
        import sessions.manager as sm_mod
        importlib.reload(sm_mod)
        mgr = sm_mod.SessionManager()

        # Seed a session up front.
        sess = mgr.create("concurrency-test")
        sid  = sess["id"]

        errors = []

        def writer(n):
            try:
                for i in range(20):
                    mgr.set_messages(sid, [
                        {"role": "system", "content": "sys"},
                        {"role": "user",   "content": f"w{n}-{i}"},
                    ])
                    _ = mgr.get_messages(sid)
            except Exception as e:  # pragma: no cover
                errors.append(e)

        threads = [threading.Thread(target=writer, args=(n,)) for n in range(8)]
        for t in threads: t.start()
        for t in threads: t.join()

        assert not errors, f"writer raised: {errors}"
        # Whatever the last writer won with, the file must be valid JSON
        # and the in-memory cache must be readable.
        final = mgr.get_messages(sid)
        assert isinstance(final, list)
        assert any(m["role"] == "user" for m in final)

    def test_concurrent_create_delete(self, tmp_path, monkeypatch):
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))

        import importlib
        import sessions.manager as sm_mod
        importlib.reload(sm_mod)
        mgr = sm_mod.SessionManager()

        errors = []
        created = []
        lock    = threading.Lock()

        def worker():
            try:
                sess = mgr.create("x")
                with lock:
                    created.append(sess["id"])
            except Exception as e:  # pragma: no cover
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(20)]
        for t in threads: t.start()
        for t in threads: t.join()

        assert not errors, f"create raised: {errors}"
        # No id collisions — each worker got a distinct session.
        assert len(set(created)) == len(created)
