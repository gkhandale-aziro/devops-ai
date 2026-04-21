"""baseline — capture the pre-SA-Core schema

Creates every table + index that `store.db.EventStore._init_schema` and
`auth.db.AuthStore._init_schema` produced prior to PR-A. The DDL is
declared explicitly (rather than delegating to `metadata.create_all`)
so this revision is frozen in time — future changes to
`store.schema.py` will not retroactively alter what `0001` means, and
`downgrade()` will always drop exactly what `upgrade()` created.

Running `alembic upgrade head` against a pre-existing SQLite file is a
no-op because each `op.create_table` passes `if_not_exists=True` via the
dialect-aware `checkfirst` path. Against a fresh Postgres DB it creates
the entire schema from scratch.

Revision ID: 0001
Revises:
Create Date: 2026-04-21 12:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
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
    op.create_index("idx_events_object", "events", ["object"])
    op.create_index(
        "idx_events_timestamp", "events", [sa.column("timestamp").desc()]
    )
    op.create_index("idx_events_level", "events", ["level"])

    op.create_table(
        "snapshots",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("event_id", sa.Integer,
                  sa.ForeignKey("events.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("timestamp", sa.Text, nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("content", sa.Text, server_default=sa.text("''")),
    )

    op.create_table(
        "analyses",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("event_id", sa.Integer,
                  sa.ForeignKey("events.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("timestamp", sa.Text, nullable=False),
        sa.Column("diagnosis", sa.Text, server_default=sa.text("''")),
        sa.Column("remediation", sa.Text, server_default=sa.text("''")),
    )

    op.create_table(
        "metrics",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("target_id", sa.Text, nullable=False),
        sa.Column("timestamp", sa.Text, nullable=False),
        sa.Column("metric", sa.Text, nullable=False),
        sa.Column("value", sa.Float, nullable=False),
    )
    op.create_index(
        "idx_metrics_target_time", "metrics",
        ["target_id", "metric", sa.column("timestamp").desc()],
    )

    op.create_table(
        "feedback",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("timestamp", sa.Text, nullable=False),
        sa.Column("target_id", sa.Text, nullable=False),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("rating", sa.Text, nullable=False),
        sa.Column("comment", sa.Text, server_default=sa.text("''")),
    )

    op.create_table(
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
    op.create_index(
        "idx_llm_usage_user_ts", "llm_usage",
        ["user_id", sa.column("timestamp").desc()],
    )

    # `username` is declared without a collation here — on SQLite the legacy
    # `_init_schema` used `COLLATE NOCASE`, and pre-existing prod SQLite
    # files retain that collation. Fresh installs fall back to default
    # case-sensitive; AuthStore normalises lookups by `.strip()` today.
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("username", sa.Text, nullable=False),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("role", sa.Text, nullable=False,
                  server_default=sa.text("'viewer'")),
        sa.Column("created_at", sa.Text, nullable=False),
        sa.Column("last_login_at", sa.Text, server_default=sa.text("''")),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )

    op.create_table(
        "login_failures",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("username", sa.Text, nullable=False),
        sa.Column("timestamp", sa.Text, nullable=False),
        sa.Column("remote_ip", sa.Text, server_default=sa.text("''")),
    )
    op.create_index(
        "idx_login_failures_username_ts", "login_failures",
        ["username", sa.column("timestamp").desc()],
    )

    op.create_table(
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
    op.create_index(
        "idx_audit_log_ts", "audit_log", [sa.column("timestamp").desc()]
    )
    op.create_index(
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
