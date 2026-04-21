"""baseline — capture the pre-SA-Core schema

Creates every table + index that `store.db.EventStore._init_schema` and
`auth.db.AuthStore._init_schema` produced prior to PR-A. The DDL is
declared explicitly (rather than delegating to `metadata.create_all`)
so this revision is frozen in time — future changes to
`store.schema.py` will not retroactively alter what `0001` means, and
`downgrade()` will always drop exactly what `upgrade()` created.

Idempotency: `op.create_table` / `op.create_index` are unconditional by
default, which would fail when `alembic upgrade head` runs against a
legacy SQLite file that already has these tables from pre-PR-A boots
(where `_init_schema` called `CREATE TABLE IF NOT EXISTS` directly).
We inspect the bind before each operation and skip whatever already
exists, so the revision remains a safe no-op on pre-populated DBs and
a full create on fresh Postgres.

Revision ID: 0001
Revises:
Create Date: 2026-04-21 12:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# SQLite-only NOCASE collation on username — matches the legacy
# `COLLATE NOCASE` from pre-PR-A `_init_schema` and no-ops on Postgres.
_USERNAME_TEXT = sa.Text().with_variant(sa.Text(collation="NOCASE"), "sqlite")


def _has_table(insp, name: str) -> bool:
    return insp.has_table(name)


def _has_index(insp, table: str, name: str) -> bool:
    if not insp.has_table(table):
        return False
    return any(ix["name"] == name for ix in insp.get_indexes(table))


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    def create_table_if_missing(name: str, *columns, **kwargs) -> None:
        if not _has_table(insp, name):
            op.create_table(name, *columns, **kwargs)

    def create_index_if_missing(name: str, table: str, columns) -> None:
        if not _has_index(insp, table, name):
            op.create_index(name, table, columns)

    create_table_if_missing(
        "events",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("timestamp", sa.Text, nullable=False),
        sa.Column("source", sa.Text, nullable=False,
                  server_default=sa.text("'kubernetes'")),
        sa.Column("level", sa.Text, nullable=False),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("object", sa.Text, nullable=False),
        sa.Column("namespace", sa.Text, server_default=sa.text("''")),
        sa.Column("message", sa.Text, server_default=sa.text("''")),
        sa.Column("status", sa.Text, nullable=False,
                  server_default=sa.text("'open'")),
        sa.Column("raw", sa.Text, server_default=sa.text("''")),
        sa.Column("target_id", sa.Text, server_default=sa.text("''")),
        sa.Column("target_name", sa.Text, server_default=sa.text("''")),
    )
    create_index_if_missing("idx_events_object", "events", ["object"])
    create_index_if_missing(
        "idx_events_timestamp", "events", [sa.column("timestamp").desc()]
    )
    create_index_if_missing("idx_events_level", "events", ["level"])

    create_table_if_missing(
        "snapshots",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("event_id", sa.Integer,
                  sa.ForeignKey("events.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("timestamp", sa.Text, nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("content", sa.Text, server_default=sa.text("''")),
    )

    create_table_if_missing(
        "analyses",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("event_id", sa.Integer,
                  sa.ForeignKey("events.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("timestamp", sa.Text, nullable=False),
        sa.Column("diagnosis", sa.Text, server_default=sa.text("''")),
        sa.Column("remediation", sa.Text, server_default=sa.text("''")),
    )

    create_table_if_missing(
        "metrics",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("target_id", sa.Text, nullable=False),
        sa.Column("timestamp", sa.Text, nullable=False),
        sa.Column("metric", sa.Text, nullable=False),
        sa.Column("value", sa.Float, nullable=False),
    )
    create_index_if_missing(
        "idx_metrics_target_time", "metrics",
        ["target_id", "metric", sa.column("timestamp").desc()],
    )

    create_table_if_missing(
        "feedback",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("timestamp", sa.Text, nullable=False),
        sa.Column("target_id", sa.Text, nullable=False),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("rating", sa.Text, nullable=False),
        sa.Column("comment", sa.Text, server_default=sa.text("''")),
    )

    create_table_if_missing(
        "llm_usage",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("timestamp", sa.Text, nullable=False),
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("model", sa.Text, nullable=False),
        sa.Column("prompt_tokens", sa.Integer, nullable=False,
                  server_default=sa.text("0")),
        sa.Column("completion_tokens", sa.Integer, nullable=False,
                  server_default=sa.text("0")),
        sa.Column("total_tokens", sa.Integer, nullable=False,
                  server_default=sa.text("0")),
        sa.Column("session_id", sa.Text, server_default=sa.text("''")),
    )
    create_index_if_missing(
        "idx_llm_usage_user_ts", "llm_usage",
        ["user_id", sa.column("timestamp").desc()],
    )

    # `username` gets SQLite-NOCASE so fresh SQLite installs match the
    # pre-PR-A `COLLATE NOCASE` behavior and legacy DBs that already
    # have the collation (create_table_if_missing skips them).
    create_table_if_missing(
        "users",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("username", _USERNAME_TEXT, nullable=False),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("role", sa.Text, nullable=False,
                  server_default=sa.text("'viewer'")),
        sa.Column("created_at", sa.Text, nullable=False),
        sa.Column("last_login_at", sa.Text, server_default=sa.text("''")),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )

    create_table_if_missing(
        "login_failures",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("username", _USERNAME_TEXT, nullable=False),
        sa.Column("timestamp", sa.Text, nullable=False),
        sa.Column("remote_ip", sa.Text, server_default=sa.text("''")),
    )
    create_index_if_missing(
        "idx_login_failures_username_ts", "login_failures",
        ["username", sa.column("timestamp").desc()],
    )

    create_table_if_missing(
        "audit_log",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("timestamp", sa.Text, nullable=False),
        sa.Column("user_id", sa.Integer),
        sa.Column("username", sa.Text, server_default=sa.text("''")),
        sa.Column("action", sa.Text, nullable=False),
        sa.Column("target", sa.Text, server_default=sa.text("''")),
        sa.Column("status", sa.Integer),
        sa.Column("remote_ip", sa.Text, server_default=sa.text("''")),
        sa.Column("request_id", sa.Text, server_default=sa.text("''")),
    )
    create_index_if_missing(
        "idx_audit_log_ts", "audit_log", [sa.column("timestamp").desc()]
    )
    create_index_if_missing(
        "idx_audit_log_user_ts", "audit_log",
        ["user_id", sa.column("timestamp").desc()],
    )


def downgrade() -> None:
    # Reverse order so FK-dependent tables drop before their parents.
    op.drop_index("idx_audit_log_user_ts", table_name="audit_log")
    op.drop_index("idx_audit_log_ts", table_name="audit_log")
    op.drop_table("audit_log")

    op.drop_index("idx_login_failures_username_ts", table_name="login_failures")
    op.drop_table("login_failures")

    op.drop_table("users")

    op.drop_index("idx_llm_usage_user_ts", table_name="llm_usage")
    op.drop_table("llm_usage")

    op.drop_table("feedback")

    op.drop_index("idx_metrics_target_time", table_name="metrics")
    op.drop_table("metrics")

    op.drop_table("analyses")
    op.drop_table("snapshots")

    op.drop_index("idx_events_level", table_name="events")
    op.drop_index("idx_events_timestamp", table_name="events")
    op.drop_index("idx_events_object", table_name="events")
    op.drop_table("events")
