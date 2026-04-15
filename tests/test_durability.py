"""
Tests for H-04 (atomic JSON writes) and H-05 (sqlite concurrency).

H-04: sessions/manager.py now writes chat_sessions.json / chat_messages.json
      via a temp file + os.replace. A crash/interrupt mid-write can leave a
      stale .tmp file behind but must never corrupt the canonical file.

H-05: store/db.py now caches one sqlite3.Connection per thread and sets
      PRAGMA busy_timeout=5000 so concurrent writers don't raise
      SQLITE_BUSY under contention.
"""
import os
import sys
import json
import sqlite3
import threading
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


# ── H-04 ─────────────────────────────────────────────────────────────────────

class TestAtomicJsonWrites:
    def test_save_writes_through_tmp_file(self, tmp_path, monkeypatch):
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
        import importlib
        import sessions.manager as sm_mod
        importlib.reload(sm_mod)

        mgr = sm_mod.SessionManager()
        sess = mgr.create("atomic-test")

        # Canonical file exists, valid JSON, contains the session.
        sessions_file = tmp_path / "chat_sessions.json"
        assert sessions_file.exists()
        with sessions_file.open("r", encoding="utf-8") as f:
            data = json.load(f)
        assert any(s["id"] == sess["id"] for s in data)

        # .tmp siblings should be cleaned up (os.replace removes the tmp).
        assert not (tmp_path / "chat_sessions.json.tmp").exists()
        assert not (tmp_path / "chat_messages.json.tmp").exists()

    def test_stale_tmp_does_not_corrupt_canonical(self, tmp_path, monkeypatch):
        """If a previous crash left a stale .tmp behind, the next write
        should overwrite it cleanly and the canonical file should stay
        valid JSON throughout."""
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
        import importlib
        import sessions.manager as sm_mod
        importlib.reload(sm_mod)

        mgr = sm_mod.SessionManager()
        mgr.create("first")

        # Simulate a prior crashed write: stale partial content in .tmp.
        stale = tmp_path / "chat_sessions.json.tmp"
        stale.write_text("{not valid json", encoding="utf-8")

        # Next write must still produce a valid canonical file.
        mgr.create("second")
        with (tmp_path / "chat_sessions.json").open("r", encoding="utf-8") as f:
            data = json.load(f)  # must not raise
        titles = [s["title"] for s in data]
        assert "second" in titles


# ── H-05 ─────────────────────────────────────────────────────────────────────

class TestSqliteConcurrency:
    def test_concurrent_writes_do_not_raise_busy(self, tmp_path, monkeypatch):
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
        import importlib
        import store.db as db_mod
        importlib.reload(db_mod)

        store = db_mod.EventStore()
        errors = []

        def writer(n):
            try:
                for i in range(30):
                    store.save_event(
                        {
                            "timestamp": "2026-04-15T10:00:00",
                            "reason":    f"TestReason{n}",
                            "object":    f"pod/test-{n}-{i}",
                            "namespace": "default",
                            "source":    "test",
                            "message":   "concurrent write test",
                            "raw":       "{}",
                        },
                        level="SEV3",
                    )
            except sqlite3.OperationalError as e:  # pragma: no cover
                errors.append(("OperationalError", str(e)))
            except Exception as e:  # pragma: no cover
                errors.append((type(e).__name__, str(e)))

        threads = [threading.Thread(target=writer, args=(n,)) for n in range(8)]
        for t in threads: t.start()
        for t in threads: t.join()

        assert not errors, f"concurrent writers raised: {errors}"

    def test_thread_local_conn_is_cached(self, tmp_path, monkeypatch):
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
        import importlib
        import store.db as db_mod
        importlib.reload(db_mod)

        store = db_mod.EventStore()

        # Two calls from the same thread should return the same object.
        c1 = store._conn()
        c2 = store._conn()
        assert c1 is c2

    def test_busy_timeout_set_on_conn(self, tmp_path, monkeypatch):
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
        import importlib
        import store.db as db_mod
        importlib.reload(db_mod)

        store = db_mod.EventStore()
        conn = store._conn()
        # busy_timeout is reported in ms; matches the value we set.
        (timeout,) = conn.execute("PRAGMA busy_timeout").fetchone()
        assert timeout == 5000
