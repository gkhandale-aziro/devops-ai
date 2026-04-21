"""
alembic/env.py — migration runner for Aziro Ops.

Design choices:
  - URL is resolved via `store.engine.resolve_url()`, same source of truth
    the running app uses. A migration never runs against a different URL
    than the one the operator thinks they configured.
  - `target_metadata` is `store.schema.metadata` — one MetaData for every
    Aziro table, so `alembic revision --autogenerate` detects all drift.
  - Online migrations acquire the Engine via `store.engine.build_engine()`
    so SQLite PRAGMAs (WAL, busy_timeout, FK) fire during the migration
    the same way they do in production.
  - `render_as_batch=True` on SQLite keeps `ALTER TABLE` working — SQLite's
    native ALTER is limited, and batch mode copies-through-new-table.
"""
from __future__ import annotations

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context


# Make repo root importable — Alembic invokes us from the project root but
# some tooling (uvicorn reload, IDE) can start from elsewhere.
_repo_root = Path(__file__).resolve().parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from store.engine import build_engine, resolve_url  # noqa: E402
from store.schema import metadata as target_metadata  # noqa: E402


config = context.config

if config.config_file_name is not None:
    # disable_existing_loggers=False preserves handlers already installed
    # by the app (observability.logging.configure_logging) or by pytest's
    # caplog fixture — otherwise alembic.command.upgrade() inside a test
    # wipes the caplog handler and later tests lose log capture.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# Override alembic.ini's placeholder URL at runtime.
config.set_main_option("sqlalchemy.url", resolve_url())


def run_migrations_offline() -> None:
    """`--sql` mode — emit DDL without opening a connection."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=url.startswith("sqlite"),
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Standard mode — connect and apply."""
    url = config.get_main_option("sqlalchemy.url")
    connectable = build_engine(url)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=connection.dialect.name == "sqlite",
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
