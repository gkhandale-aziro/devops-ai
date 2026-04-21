"""baseline — capture the pre-SA-Core schema

Creates every table + index that `store.db.EventStore._init_schema` and
`auth.db.AuthStore._init_schema` produced prior to PR-A. The DDL comes
from `store.schema.metadata` so this migration and `metadata.create_all`
are guaranteed to agree.

Running `alembic upgrade head` against a pre-existing SQLite file is a
no-op for tables that already exist (SA's DDL compiler honours IF NOT
EXISTS via `checkfirst=True`). Against a fresh Postgres DB it creates
the entire schema from scratch.

Revision ID: 0001
Revises:
Create Date: 2026-04-21 12:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

from store.schema import metadata


revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    metadata.drop_all(bind=op.get_bind(), checkfirst=True)
