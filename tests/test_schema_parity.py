"""
Tests for PR-A — SQLAlchemy Core + Alembic dual-backend.

We verify three things that together guarantee we didn't silently change
the production schema while porting from raw sqlite3 to SA Core:

    1. Every table that legacy `_init_schema` created is still present
       after `metadata.create_all(engine)`, with the same columns and
       the same indexes.
    2. `alembic upgrade head` on a fresh SQLite DB produces a schema
       indistinguishable from what `metadata.create_all(engine)` does.
    3. `alembic upgrade head && alembic downgrade base && alembic
       upgrade head` returns the DB to its initial (empty-of-data,
       full-of-tables) state — proves the paired downgrade works.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from store.schema import metadata  # noqa: E402


# The full list of tables every Aziro Ops install must have after boot.
EXPECTED_TABLES = {
    "events", "snapshots", "analyses", "metrics", "feedback", "llm_usage",
    "users", "login_failures", "audit_log",
}

# Per-table columns that predate PR-A. If one of these goes missing, an
# existing prod SQLite file would break on read — so this is the tripwire.
EXPECTED_COLUMNS: dict[str, set[str]] = {
    "events": {
        "id", "timestamp", "source", "level", "reason", "object",
        "namespace", "message", "status", "raw", "target_id", "target_name",
    },
    "snapshots":     {"id", "event_id", "timestamp", "kind", "content"},
    "analyses":      {"id", "event_id", "timestamp", "diagnosis", "remediation"},
    "metrics":       {"id", "target_id", "timestamp", "metric", "value"},
    "feedback":      {"id", "timestamp", "target_id", "message", "rating", "comment"},
    "llm_usage": {
        "id", "timestamp", "user_id", "model", "prompt_tokens",
        "completion_tokens", "total_tokens", "session_id",
    },
    "users": {
        "id", "username", "password_hash", "role", "created_at", "last_login_at",
    },
    "login_failures": {"id", "username", "timestamp", "remote_ip"},
    "audit_log": {
        "id", "timestamp", "user_id", "username", "action", "target",
        "status", "remote_ip", "request_id",
    },
}

EXPECTED_INDEXES = {
    "events":        {"idx_events_object", "idx_events_timestamp", "idx_events_level"},
    "metrics":       {"idx_metrics_target_time"},
    "llm_usage":     {"idx_llm_usage_user_ts"},
    "login_failures": {"idx_login_failures_username_ts"},
    "audit_log":     {"idx_audit_log_ts", "idx_audit_log_user_ts"},
}


def _fresh_sqlite(tmp_path: Path, name: str):
    """Build a throwaway SQLite engine rooted at tmp_path/name.db."""
    from store.engine import build_engine
    return build_engine(f"sqlite:///{tmp_path / name}.db")


def _assert_full_parity(engine) -> None:
    """Table + column + index parity against EXPECTED_* on `engine`.

    Used for the Alembic tests too — asserting only table names would
    let a migration drift on columns or indexes while the suite still
    passed, so the explicit revision gets the same tripwires as
    `metadata.create_all`.
    """
    insp = inspect(engine)
    present = set(insp.get_table_names()) - {"alembic_version"}
    assert present == EXPECTED_TABLES, (
        f"table drift — missing: {EXPECTED_TABLES - present}, "
        f"unexpected: {present - EXPECTED_TABLES}"
    )
    for table, cols in EXPECTED_COLUMNS.items():
        actual = {c["name"] for c in insp.get_columns(table)}
        assert actual == cols, (
            f"{table} column drift — missing: {cols - actual}, "
            f"unexpected: {actual - cols}"
        )
    for table, indexes in EXPECTED_INDEXES.items():
        actual = {i["name"] for i in insp.get_indexes(table)}
        assert actual == indexes, (
            f"{table} index drift — missing: {indexes - actual}, "
            f"unexpected: {actual - indexes}"
        )


class TestMetadataCreateAll:
    def test_tables_match_exactly(self, tmp_path):
        """Catches BOTH missing tables (old table deleted) and surprise
        additions (new Table() not yet reflected in EXPECTED_TABLES).
        Symmetric equality is the point — a drift in either direction is
        a schema change that should land as an explicit Alembic revision
        plus a test update, not as a silent pass."""
        engine = _fresh_sqlite(tmp_path, "create_all")
        metadata.create_all(engine)
        insp = inspect(engine)
        present = set(insp.get_table_names())
        assert present == EXPECTED_TABLES, (
            f"schema drift — missing: {EXPECTED_TABLES - present}, "
            f"unexpected: {present - EXPECTED_TABLES}"
        )

    @pytest.mark.parametrize("table,cols", sorted(EXPECTED_COLUMNS.items()))
    def test_table_has_expected_columns(self, tmp_path, table, cols):
        engine = _fresh_sqlite(tmp_path, f"cols_{table}")
        metadata.create_all(engine)
        insp = inspect(engine)
        actual = {c["name"] for c in insp.get_columns(table)}
        assert actual == cols, (
            f"{table} column drift — missing: {cols - actual}, "
            f"unexpected: {actual - cols}"
        )

    @pytest.mark.parametrize("table,indexes", sorted(EXPECTED_INDEXES.items()))
    def test_table_has_expected_indexes(self, tmp_path, table, indexes):
        engine = _fresh_sqlite(tmp_path, f"idx_{table}")
        metadata.create_all(engine)
        insp = inspect(engine)
        actual = {i["name"] for i in insp.get_indexes(table)}
        assert actual == indexes, (
            f"{table} index drift — missing: {indexes - actual}, "
            f"unexpected: {actual - indexes}"
        )


class TestAlembicBaseline:
    def _alembic_config(self, url: str):
        from alembic.config import Config
        repo_root = Path(__file__).resolve().parent.parent
        cfg = Config(str(repo_root / "alembic.ini"))
        cfg.set_main_option("script_location", str(repo_root / "alembic"))
        cfg.set_main_option("sqlalchemy.url", url)
        return cfg

    def test_baseline_upgrade_creates_full_schema(self, tmp_path, monkeypatch):
        from alembic import command
        url = f"sqlite:///{tmp_path / 'baseline.db'}"
        monkeypatch.setenv("AZIRO_DB_URL", url)

        command.upgrade(self._alembic_config(url), "head")

        engine = create_engine(url)
        try:
            _assert_full_parity(engine)
        finally:
            engine.dispose()

    def test_upgrade_downgrade_roundtrip(self, tmp_path, monkeypatch):
        from alembic import command
        url = f"sqlite:///{tmp_path / 'roundtrip.db'}"
        monkeypatch.setenv("AZIRO_DB_URL", url)
        cfg = self._alembic_config(url)

        command.upgrade(cfg, "head")
        command.downgrade(cfg, "base")

        engine = create_engine(url)
        try:
            insp = inspect(engine)
            # After downgrade, only alembic_version should remain (empty).
            leftover = set(insp.get_table_names()) - {"alembic_version"}
            assert leftover == set(), f"downgrade left tables behind: {leftover}"
        finally:
            engine.dispose()

        # Re-upgrading should restore every table, column, and index.
        command.upgrade(cfg, "head")
        engine = create_engine(url)
        try:
            _assert_full_parity(engine)
        finally:
            engine.dispose()
