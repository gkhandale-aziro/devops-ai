"""
tests/test_db3_migrate.py — coverage for scripts/migrate_sqlite_to_pg.py.

These tests run SQLite-on-SQLite to avoid requiring a Postgres container in
CI. The migration script's Postgres-specific ops (`setval`, `TRUNCATE …
CASCADE`) are dialect-gated, so the copy pipeline exercises the same code
paths either way — what we verify here is:

    - Table enumeration respects FK order (snapshots after events, etc.).
    - Rows round-trip with primary keys preserved.
    - `_assert_target_empty` refuses to clobber existing data without --force.
    - `--force` truncates before copy and leaves the target matching source.
    - `cmd_verify` returns 0 on match, non-zero on drift.
    - `_safe_target` never leaks passwords.
    - `_default_source_url` honors AZIRO_DATA_DIR.

The script is imported as a module so we can call `cmd_execute` / `cmd_verify`
directly and bypass the CLI's "target must be postgresql://" guard; the guard
is validated separately in TestValidateUrls.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select, text

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts import migrate_sqlite_to_pg as mig  # noqa: E402
from store.schema import metadata  # noqa: E402


# ── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def src_engine(tmp_path):
    """Source SQLite pre-populated with a small but FK-spanning dataset."""
    url = f"sqlite:///{tmp_path / 'src.db'}"
    engine = create_engine(url, future=True)
    metadata.create_all(engine)
    _seed_source(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def dst_engine(tmp_path):
    """Empty target SQLite with schema already applied (mirrors the prod
    expectation that `alembic upgrade head` has run before --execute)."""
    url = f"sqlite:///{tmp_path / 'dst.db'}"
    engine = create_engine(url, future=True)
    metadata.create_all(engine)
    yield engine
    engine.dispose()


def _seed_source(engine):
    """Populate one row in every table, with cross-table FKs that will
    break if load order is wrong."""
    with engine.begin() as conn:
        # events (parent)
        conn.execute(metadata.tables["events"].insert(), [
            {"id": 1, "timestamp": "2026-04-21T10:00:00Z", "source": "kubernetes",
             "level": "warn", "reason": "CrashLoopBackOff", "object": "pod/web-1",
             "namespace": "default", "message": "pod crashing", "status": "open",
             "raw": "{}", "target_id": "t1", "target_name": "cluster-a"},
            {"id": 2, "timestamp": "2026-04-21T10:05:00Z", "source": "kubernetes",
             "level": "info", "reason": "Scheduled", "object": "pod/web-2",
             "namespace": "default", "message": "pod scheduled", "status": "open",
             "raw": "{}", "target_id": "t1", "target_name": "cluster-a"},
        ])
        # snapshots (child of events)
        conn.execute(metadata.tables["snapshots"].insert(), [
            {"id": 1, "event_id": 1, "timestamp": "2026-04-21T10:00:01Z",
             "kind": "logs", "content": "err: OOM"},
        ])
        # analyses (child of events)
        conn.execute(metadata.tables["analyses"].insert(), [
            {"id": 1, "event_id": 1, "timestamp": "2026-04-21T10:00:02Z",
             "diagnosis": "OOM", "remediation": "bump memory limit"},
        ])
        # metrics (no FK)
        conn.execute(metadata.tables["metrics"].insert(), [
            {"id": 1, "target_id": "t1", "timestamp": "2026-04-21T10:00:00Z",
             "metric": "cpu", "value": 0.85},
        ])
        # feedback (no FK)
        conn.execute(metadata.tables["feedback"].insert(), [
            {"id": 1, "timestamp": "2026-04-21T09:00:00Z", "target_id": "t1",
             "message": "hi", "rating": "up", "comment": ""},
        ])
        # llm_usage (no FK)
        conn.execute(metadata.tables["llm_usage"].insert(), [
            {"id": 1, "timestamp": "2026-04-21T10:00:00Z", "user_id": "u1",
             "model": "gemini/flash", "prompt_tokens": 10, "completion_tokens": 20,
             "total_tokens": 30, "session_id": "s1"},
        ])
        # users (parent)
        conn.execute(metadata.tables["users"].insert(), [
            {"id": 1, "username": "admin", "password_hash": "$2b$12$fake",
             "role": "admin", "created_at": "2026-04-21T00:00:00Z",
             "last_login_at": ""},
        ])
        # login_failures (no FK but logically references users.username)
        conn.execute(metadata.tables["login_failures"].insert(), [
            {"id": 1, "username": "admin", "timestamp": "2026-04-21T00:00:01Z",
             "remote_ip": "1.2.3.4"},
        ])
        # audit_log (references users.id via user_id, no hard FK)
        conn.execute(metadata.tables["audit_log"].insert(), [
            {"id": 1, "timestamp": "2026-04-21T10:00:00Z", "user_id": 1,
             "username": "admin", "action": "login", "target": "",
             "status": 200, "remote_ip": "1.2.3.4", "request_id": "r1"},
        ])


# ── TestExecuteCopy ─────────────────────────────────────────────────────────

class TestExecuteCopy:
    def test_execute_copies_all_tables_with_ids_preserved(
        self, src_engine, dst_engine
    ):
        """Every row round-trips identically — PK values survive so FK-linked
        children (snapshots.event_id → events.id) stay resolvable."""
        mig.cmd_execute(src_engine, dst_engine, batch_size=100, force=False)

        for table in metadata.sorted_tables:
            with src_engine.connect() as sc, dst_engine.connect() as dc:
                src_rows = [dict(r) for r in sc.execute(select(table)).mappings()]
                dst_rows = [dict(r) for r in dc.execute(select(table)).mappings()]
            assert src_rows == dst_rows, f"{table.name} drifted"

    def test_execute_refuses_non_empty_target_without_force(
        self, src_engine, dst_engine
    ):
        """Second --execute with existing data must abort before writing
        so a re-run of the migration doesn't produce half-populated state."""
        mig.cmd_execute(src_engine, dst_engine, batch_size=100, force=False)
        with pytest.raises(SystemExit, match="already has"):
            mig.cmd_execute(src_engine, dst_engine, batch_size=100, force=False)

    def test_execute_force_truncates_and_recopies(
        self, src_engine, dst_engine
    ):
        """--force path: target gets wiped, then re-populated from source."""
        mig.cmd_execute(src_engine, dst_engine, batch_size=100, force=False)
        # Corrupt the target to prove --force re-syncs it.
        with dst_engine.begin() as conn:
            conn.execute(text("DELETE FROM audit_log"))
            conn.execute(text("DELETE FROM login_failures"))
            conn.execute(text("DELETE FROM users"))
            conn.execute(text("UPDATE events SET level='CORRUPTED'"))

        mig.cmd_execute(src_engine, dst_engine, batch_size=100, force=True)

        with dst_engine.connect() as conn:
            level = conn.execute(
                text("SELECT level FROM events WHERE id=1")
            ).scalar_one()
        assert level == "warn"

    def test_execute_handles_empty_source_table(self, tmp_path, dst_engine):
        """A source table with zero rows should be a no-op, not a crash."""
        url = f"sqlite:///{tmp_path / 'empty.db'}"
        empty_src = create_engine(url, future=True)
        metadata.create_all(empty_src)
        try:
            mig.cmd_execute(empty_src, dst_engine, batch_size=100, force=False)
            with dst_engine.connect() as conn:
                count = conn.execute(
                    text("SELECT COUNT(*) FROM events")
                ).scalar_one()
            assert count == 0
        finally:
            empty_src.dispose()

    def test_execute_respects_batch_size(self, src_engine, dst_engine):
        """Small batch size must still produce the full copy — proves the
        chunked iterator exhausts source rows correctly."""
        mig.cmd_execute(src_engine, dst_engine, batch_size=1, force=False)
        with dst_engine.connect() as conn:
            count = conn.execute(
                text("SELECT COUNT(*) FROM events")
            ).scalar_one()
        assert count == 2


# ── TestVerify ──────────────────────────────────────────────────────────────

class TestVerify:
    def test_verify_returns_zero_on_match(self, src_engine, dst_engine):
        """Post-copy verify passes — exit 0 is what cut-over scripts check."""
        mig.cmd_execute(src_engine, dst_engine, batch_size=100, force=False)
        rc = mig.cmd_verify(src_engine, dst_engine)
        assert rc == 0

    def test_verify_returns_nonzero_on_drift(self, src_engine, dst_engine):
        """Row-count mismatch must exit non-zero so CI / cut-over scripts
        surface the drift instead of silently proceeding."""
        mig.cmd_execute(src_engine, dst_engine, batch_size=100, force=False)
        with dst_engine.begin() as conn:
            conn.execute(text("DELETE FROM events WHERE id=2"))
        rc = mig.cmd_verify(src_engine, dst_engine)
        assert rc == 1

    def test_verify_on_empty_both_sides(self, tmp_path):
        """Fresh install verify (no rows anywhere) is still a pass."""
        s_url = f"sqlite:///{tmp_path / 's.db'}"
        d_url = f"sqlite:///{tmp_path / 'd.db'}"
        s = create_engine(s_url, future=True)
        d = create_engine(d_url, future=True)
        metadata.create_all(s)
        metadata.create_all(d)
        try:
            assert mig.cmd_verify(s, d) == 0
        finally:
            s.dispose()
            d.dispose()


# ── TestDryRun ──────────────────────────────────────────────────────────────

class TestDryRun:
    def test_dry_run_does_not_write(self, src_engine, dst_engine, capsys):
        """--dry-run is read-only on both sides — target row counts stay zero."""
        mig.cmd_dry_run(src_engine, dst_engine)
        with dst_engine.connect() as conn:
            count = conn.execute(text("SELECT COUNT(*) FROM events")).scalar_one()
        assert count == 0

    def test_dry_run_reports_per_table_counts(
        self, src_engine, dst_engine, capsys
    ):
        """stdout shows every table name and its source row count so the
        operator can sanity-check expectations before --execute."""
        mig.cmd_dry_run(src_engine, dst_engine)
        out = capsys.readouterr().out
        assert "events" in out
        assert "users" in out
        # The 2-row events table should show up with its count.
        assert "2" in out


# ── TestAssertTargetEmpty ───────────────────────────────────────────────────

class TestAssertTargetEmpty:
    def test_missing_target_table_raises_migration_hint(self, src_engine, tmp_path):
        """If the target schema hasn't been created yet, the message should
        nudge the operator toward `scripts.db upgrade`."""
        url = f"sqlite:///{tmp_path / 'no-schema.db'}"
        bare = create_engine(url, future=True)
        try:
            with pytest.raises(SystemExit, match=r"scripts\.db upgrade"):
                mig._assert_target_empty(bare, force=False)
        finally:
            bare.dispose()

    def test_passes_when_target_empty(self, dst_engine):
        """Empty target (schema applied, zero rows) is the happy path for
        --execute — the guard must not raise."""
        mig._assert_target_empty(dst_engine, force=False)


# ── TestValidateUrls ────────────────────────────────────────────────────────

class TestValidateUrls:
    def test_execute_requires_postgres_target(self):
        """--execute against a non-Postgres target is almost certainly a
        mistake; fail fast rather than let the copy run and silently succeed."""
        with pytest.raises(SystemExit, match="target must be postgresql"):
            mig._validate_urls("sqlite:///src.db", "sqlite:///dst.db", "execute")

    def test_verify_requires_postgres_target(self):
        """Same guard as --execute — verify is meant for the cut-over window."""
        with pytest.raises(SystemExit, match="target must be postgresql"):
            mig._validate_urls("sqlite:///src.db", "sqlite:///dst.db", "verify")

    def test_dry_run_allows_any_target(self):
        """Dry-run is read-only on both sides, so the PG requirement doesn't
        apply — operators may want to sanity-check a SQLite snapshot."""
        mig._validate_urls("sqlite:///src.db", "sqlite:///dst.db", "dry-run")

    def test_non_sqlite_source_rejected(self):
        """Source must be SQLite — the migration script is SQLite → PG by
        design, not a generic cross-engine copier."""
        with pytest.raises(SystemExit, match="source must be sqlite"):
            mig._validate_urls(
                "postgresql://x/y", "postgresql://a/b", "execute"
            )

    def test_accepts_postgresql_psycopg_scheme(self):
        """`postgresql+psycopg://…` is the production URL shape; must not
        trip the prefix check (`startswith('postgresql')` covers it)."""
        mig._validate_urls(
            "sqlite:///src.db",
            "postgresql+psycopg://aziro:pw@pg:5432/aziro",
            "execute",
        )


# ── TestHelpers ─────────────────────────────────────────────────────────────

class TestHelpers:
    def test_safe_target_masks_password(self):
        """Passwords never reach stdout — the banner echoes the target URL
        at every invocation, so a leak here would hit CI logs directly."""
        shown = mig._safe_target("postgresql+psycopg://aziro:s3cret@pg:5432/aziro")
        assert "s3cret" not in shown
        assert "aziro" in shown
        assert "pg" in shown

    def test_safe_target_tolerates_garbage(self):
        """A broken URL must not crash the banner print at script startup."""
        shown = mig._safe_target("not-a-url")
        assert shown  # just returns something non-empty

    def test_default_source_url_honors_data_dir(self, tmp_path, monkeypatch):
        """AZIRO_DATA_DIR override points the default SQLite source at a
        custom path — matches `store/engine.py::_default_sqlite_url`."""
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
        url = mig._default_source_url()
        assert url.startswith("sqlite:///")
        assert "aziro.db" in url
        # Windows paths are case-insensitive; the data dir should be a
        # prefix (after the sqlite:/// scheme) of the resulting path.
        assert str(tmp_path).replace("\\", "/").lower() in url.lower().replace("\\", "/")


# ── TestCliMain ─────────────────────────────────────────────────────────────

class TestCliMain:
    def test_main_requires_one_mode(self):
        """Argparse mutually-exclusive required group — running with no mode
        flag must exit (not silently default)."""
        with pytest.raises(SystemExit):
            mig.main([])

    def test_main_mutually_exclusive_modes(self, capsys):
        """Passing both --dry-run and --execute must exit — avoids the
        "did the script run in the mode I thought?" ambiguity."""
        with pytest.raises(SystemExit):
            mig.main(["--dry-run", "--execute"])

    def test_main_execute_without_target_url_fails_fast(self, monkeypatch):
        """Missing AZIRO_DB_URL on --execute surfaces a clear error rather
        than silently falling back to an empty-string URL."""
        monkeypatch.delenv("AZIRO_DB_URL", raising=False)
        with pytest.raises(SystemExit, match="target URL required"):
            mig.main(["--execute"])

    def test_main_dry_run_with_sqlite_source_runs(
        self, tmp_path, monkeypatch, capsys
    ):
        """End-to-end: --dry-run against an empty in-memory-ish source and
        no target should still produce the row-count table (all zeros)."""
        src = tmp_path / "src.db"
        engine = create_engine(f"sqlite:///{src}", future=True)
        metadata.create_all(engine)
        engine.dispose()

        monkeypatch.delenv("AZIRO_DB_URL", raising=False)
        rc = mig.main(["--dry-run", f"--source-url=sqlite:///{src}"])
        assert rc == 0
        out = capsys.readouterr().out
        assert "source rows to copy:" in out
