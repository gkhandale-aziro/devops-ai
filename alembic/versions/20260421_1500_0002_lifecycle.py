"""lifecycle — add 8-state incident machine

Adds the columns and table required by store/lifecycle.py:

  - events.lifecycle_state   TEXT NOT NULL DEFAULT 'Detected'
  - events.approved_by       TEXT DEFAULT ''
  - events.approved_at       TEXT DEFAULT ''
  - idx_events_lifecycle_state  (events.lifecycle_state)
  - incident_transitions     (append-only log of state changes)

The columns are added with a server_default so existing rows on legacy
DBs (where every row already represents something `Detected`) land in a
sensible initial state without a data-migration pass.

Idempotency: on operator re-runs and on legacy SQLite files that already
have some of these objects (defensive against future merges that may
need to re-apply), we inspect before acting. Follows the same pattern
as 0001_baseline.

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-21 15:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(insp, table: str, column: str) -> bool:
    if not insp.has_table(table):
        return False
    return any(c["name"] == column for c in insp.get_columns(table))


def _has_index(insp, table: str, name: str) -> bool:
    if not insp.has_table(table):
        return False
    return any(ix["name"] == name for ix in insp.get_indexes(table))


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    # `batch_alter_table` is a no-op on Postgres and a copy-through-new-
    # table on SQLite — needed because SQLite's native ALTER can't drop
    # the column in downgrade(). We still gate each add_column so repeat
    # upgrades don't raise "duplicate column".
    new_cols = [
        ("lifecycle_state", sa.Column(
            "lifecycle_state", sa.Text(), nullable=False,
            server_default=sa.text("'Detected'"))),
        ("approved_by", sa.Column(
            "approved_by", sa.Text(), server_default=sa.text("''"))),
        ("approved_at", sa.Column(
            "approved_at", sa.Text(), server_default=sa.text("''"))),
    ]
    missing = [
        (name, col) for name, col in new_cols
        if not _has_column(insp, "events", name)
    ]
    if missing:
        with op.batch_alter_table("events") as batch_op:
            for _, col in missing:
                batch_op.add_column(col)
        insp.clear_cache()

    if not _has_index(insp, "events", "idx_events_lifecycle_state"):
        op.create_index(
            "idx_events_lifecycle_state", "events", ["lifecycle_state"]
        )
        insp.clear_cache()

    if not insp.has_table("incident_transitions"):
        op.create_table(
            "incident_transitions",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column(
                "event_id", sa.Integer,
                sa.ForeignKey("events.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("timestamp", sa.Text, nullable=False),
            sa.Column("from_state", sa.Text, server_default=sa.text("''")),
            sa.Column("to_state", sa.Text, nullable=False),
            sa.Column("actor", sa.Text, nullable=False,
                      server_default=sa.text("'system'")),
            sa.Column("reason", sa.Text, server_default=sa.text("''")),
            sa.Column("details", sa.Text, server_default=sa.text("''")),
        )
        insp.clear_cache()

    if not _has_index(insp, "incident_transitions",
                      "idx_incident_transitions_event_ts"):
        op.create_index(
            "idx_incident_transitions_event_ts",
            "incident_transitions",
            ["event_id", sa.column("timestamp").desc()],
        )


def downgrade() -> None:
    op.drop_index(
        "idx_incident_transitions_event_ts",
        table_name="incident_transitions",
    )
    op.drop_table("incident_transitions")

    op.drop_index("idx_events_lifecycle_state", table_name="events")

    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_column("approved_at")
        batch_op.drop_column("approved_by")
        batch_op.drop_column("lifecycle_state")
