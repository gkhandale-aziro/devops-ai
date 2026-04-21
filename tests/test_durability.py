"""
Tests for H-04 (atomic JSON writes) and H-05 (sqlite concurrency).

H-04: sessions/manager.py writes chat_sessions.json / chat_messages.json
      via a temp file + os.replace. A crash/interrupt mid-write can leave
      a stale .tmp file behind but must never corrupt the canonical file.

H-05: store/db.py goes through a SQLAlchemy Engine (PR-A). The SQLite
      PRAGMAs (journal_mode=WAL, foreign_keys=ON, busy_timeout=5000) are
      applied on every new DBAPI connection by a connect-event listener
      in `store.engine`, so concurrent writers still don't raise
      SQLITE_BUSY under contention.
"""
import os
import sys
import json
import sqlite3
import threading

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
    def test_concurrent_writes_do_not_raise_busy(self, tmp_path):
        from store.db import EventStore

        store = EventStore(db_file=str(tmp_path / "aziro.db"))
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

    def test_engine_pool_hands_out_connections(self, tmp_path):
        """Post-PR-A: thread-local caching moved into SQLAlchemy's pool.

        The pool still gives us isolated connections per checkout without
        reopening the DB file each call, so the performance property the
        original test guarded survives — just at a different layer.
        """
        from sqlalchemy import event
        from store.db import EventStore

        store = EventStore(db_file=str(tmp_path / "aziro.db"))

        # `checkedin() >= 1` would still pass if the pool opened two
        # separate DBAPI connections and returned only one — which is
        # the exact regression this test guards against. Counting
        # `connect` events across two sequential checkouts proves
        # reuse: the DBAPI connection is opened once and the second
        # checkout gets the pooled connection back.
        #
        # Dispose first so `__init__`-time connects (e.g. WAL PRAGMA)
        # don't pre-inflate the counter.
        store._engine.dispose()

        connects: list[int] = [0]

        @event.listens_for(store._engine, "connect")
        def _count(_dbapi_conn, _conn_record):
            connects[0] += 1

        raw1 = store._engine.raw_connection()
        raw1.close()
        raw2 = store._engine.raw_connection()
        raw2.close()

        assert connects[0] == 1, (
            f"pool opened {connects[0]} DBAPI connections for 2 "
            f"sequential checkouts — expected 1 (reuse)"
        )

    def test_busy_timeout_set_on_new_connections(self, tmp_path):
        """The connect-event listener in store.engine should apply
        PRAGMA busy_timeout=5000 to every new SQLite DBAPI connection."""
        from store.db import EventStore

        store = EventStore(db_file=str(tmp_path / "aziro.db"))
        raw = store._engine.raw_connection()
        try:
            cur = raw.cursor()
            (timeout,) = cur.execute("PRAGMA busy_timeout").fetchone()
            cur.close()
        finally:
            raw.close()
        assert timeout == 5000
