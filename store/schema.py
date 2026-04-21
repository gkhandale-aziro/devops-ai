"""
store/schema.py — single SQLAlchemy `MetaData` declaring every Aziro table.

Both `EventStore` (events, snapshots, analyses, metrics, feedback,
llm_usage) and `AuthStore` (users, login_failures, audit_log) share the
one MetaData so:

    - Alembic can autogenerate migrations from a single import.
    - `metadata.create_all(engine)` on boot is a no-op on existing DBs
      and fully bootstraps a fresh one in tests.
    - `tests/test_schema_parity.py` can diff generated DDL against the
      legacy `_init_schema` strings.

Column types stay dialect-portable:
    - Integer             → INTEGER on SQLite, INTEGER on Postgres
    - Text                → TEXT on both
    - Float               → REAL on SQLite, DOUBLE PRECISION on Postgres
    - server_default=text("…") → rendered verbatim in CREATE TABLE DDL

Timestamps remain `Text` (ISO-8601 strings) to avoid changing the
read/write shape in PR-A. PR-C revisits this when we migrate to Postgres
— at which point `DateTime(timezone=True)` is the right target, and the
SQLite→PG migration script converts strings to TIMESTAMPTZ.
"""
from __future__ import annotations

from sqlalchemy import (
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Table,
    Text,
    UniqueConstraint,
    column,
    text,
)


metadata = MetaData()


# ── store/db.py tables ──────────────────────────────────────────────────────

events = Table(
    "events",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("timestamp", Text, nullable=False),
    Column("source", Text, nullable=False, server_default=text("'kubernetes'")),
    Column("level", Text, nullable=False),
    Column("reason", Text, nullable=False),
    Column("object", Text, nullable=False),
    Column("namespace", Text, server_default=text("''")),
    Column("message", Text, server_default=text("''")),
    Column("status", Text, nullable=False, server_default=text("'open'")),
    Column("raw", Text, server_default=text("''")),
    Column("target_id", Text, server_default=text("''")),
    Column("target_name", Text, server_default=text("''")),
    # Lifecycle (added v1.0): every event is also an incident progressing
    # through the 8-state machine in store/lifecycle.py. `status` stays
    # ('open'/'closed') for back-compat with the older API; lifecycle_state
    # is the fine-grained one the UI timeline renders.
    Column(
        "lifecycle_state",
        Text,
        nullable=False,
        server_default=text("'Detected'"),
    ),
    Column("approved_by", Text, server_default=text("''")),
    Column("approved_at", Text, server_default=text("''")),
    Index("idx_events_object", "object"),
    Index("idx_events_timestamp", column("timestamp").desc()),
    Index("idx_events_level", "level"),
    Index("idx_events_lifecycle_state", "lifecycle_state"),
)

snapshots = Table(
    "snapshots",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column(
        "event_id",
        Integer,
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("timestamp", Text, nullable=False),
    Column("kind", Text, nullable=False),
    Column("content", Text, server_default=text("''")),
)

analyses = Table(
    "analyses",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column(
        "event_id",
        Integer,
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("timestamp", Text, nullable=False),
    Column("diagnosis", Text, server_default=text("''")),
    Column("remediation", Text, server_default=text("''")),
)

metrics = Table(
    "metrics",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("target_id", Text, nullable=False),
    Column("timestamp", Text, nullable=False),
    Column("metric", Text, nullable=False),
    Column("value", Float, nullable=False),
    Index("idx_metrics_target_time", "target_id", "metric", column("timestamp").desc()),
)

feedback = Table(
    "feedback",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("timestamp", Text, nullable=False),
    Column("target_id", Text, nullable=False),
    Column("message", Text, nullable=False),
    Column("rating", Text, nullable=False),
    Column("comment", Text, server_default=text("''")),
)

llm_usage = Table(
    "llm_usage",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("timestamp", Text, nullable=False),
    Column("user_id", Text, nullable=False),
    Column("model", Text, nullable=False),
    Column("prompt_tokens", Integer, nullable=False, server_default=text("0")),
    Column("completion_tokens", Integer, nullable=False, server_default=text("0")),
    Column("total_tokens", Integer, nullable=False, server_default=text("0")),
    Column("session_id", Text, server_default=text("''")),
    Index("idx_llm_usage_user_ts", "user_id", column("timestamp").desc()),
)


# Append-only log of every state change on events. The `from_state` is
# nullable because the initial Detected insert has no predecessor. The
# `actor` is either a username (approval, manual transition) or a system
# tag like "system:ingest" / "system:analyzer" / "system:executor" so
# the timeline can attribute who/what moved the incident forward.
incident_transitions = Table(
    "incident_transitions",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column(
        "event_id",
        Integer,
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("timestamp", Text, nullable=False),
    Column("from_state", Text, server_default=text("''")),
    Column("to_state", Text, nullable=False),
    Column("actor", Text, nullable=False, server_default=text("'system'")),
    Column("reason", Text, server_default=text("''")),
    Column("details", Text, server_default=text("''")),
    Index("idx_incident_transitions_event_ts",
          "event_id", column("timestamp").desc()),
)


# ── auth/db.py tables ───────────────────────────────────────────────────────
#
# `username` carries a SQLite-only `NOCASE` collation via `.with_variant`.
# The legacy `_init_schema` used `COLLATE NOCASE`, and pre-existing prod
# SQLite files retain it — without this variant, fresh SQLite installs
# would silently allow `Alice` and `alice` to coexist while upgraded
# installs still reject that pair, making auth case-sensitivity depend
# on install history. Postgres gets no collation hint here; PR-C layers
# `.lower()` normalisation in AuthStore to address the PG side.

_USERNAME_TEXT = Text().with_variant(Text(collation="NOCASE"), "sqlite")


users = Table(
    "users",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("username", _USERNAME_TEXT, nullable=False),
    Column("password_hash", Text, nullable=False),
    Column("role", Text, nullable=False, server_default=text("'viewer'")),
    Column("created_at", Text, nullable=False),
    Column("last_login_at", Text, server_default=text("''")),
    UniqueConstraint("username", name="uq_users_username"),
)

login_failures = Table(
    "login_failures",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    # Same NOCASE-on-SQLite story as `users.username` so a lockout
    # counter written for "Alice" is the one read back for "alice".
    Column("username", _USERNAME_TEXT, nullable=False),
    Column("timestamp", Text, nullable=False),
    Column("remote_ip", Text, server_default=text("''")),
    Index("idx_login_failures_username_ts", "username", column("timestamp").desc()),
)

audit_log = Table(
    "audit_log",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("timestamp", Text, nullable=False),
    Column("user_id", Integer),
    Column("username", Text, server_default=text("''")),
    Column("action", Text, nullable=False),
    Column("target", Text, server_default=text("''")),
    Column("status", Integer),
    Column("remote_ip", Text, server_default=text("''")),
    Column("request_id", Text, server_default=text("''")),
    Index("idx_audit_log_ts", column("timestamp").desc()),
    Index("idx_audit_log_user_ts", "user_id", column("timestamp").desc()),
)
