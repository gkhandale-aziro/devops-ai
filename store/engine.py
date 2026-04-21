"""
store/engine.py — SQLAlchemy engine factory for SQLite (default) or Postgres.

One engine per process. The URL is resolved once, in this order:

    1. Explicit URL passed to `build_engine(url)` — isolated instance.
    2. `AZIRO_DB_URL` env var — process-wide shared engine.
    3. `sqlite:///<AZIRO_DATA_DIR>/aziro.db` — process-wide shared engine.

`EventStore` and `AuthStore` take an optional `db_file=` for back-compat
with tests that want a file-path-based SQLite; when set, the store builds
its own isolated engine rather than sharing the process-wide one.

SQLite PRAGMAs (journal_mode=WAL, foreign_keys=ON, busy_timeout=5000) are
applied on every new DBAPI connection via a connect-event listener so the
behaviour we had in the pre-SA Core store is preserved — no caller has to
remember to PRAGMA manually.
"""
from __future__ import annotations

import os
import sqlite3
import threading
from typing import Optional

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.pool import StaticPool


_PROCESS_ENGINE: Optional[Engine] = None
_PROCESS_ENGINE_LOCK = threading.Lock()

# INSERT ... RETURNING landed in SQLite 3.35.0 (March 2021). save_event() and
# auth/db.py create_user() both rely on it. Ubuntu 20.04 ships 3.31.1 and
# would fail with a cryptic "near RETURNING: syntax error" mid-request;
# checking once at import is a better UX than a mystery query failure.
_MIN_SQLITE = (3, 35, 0)


def _default_sqlite_url() -> str:
    """URL pointing at the on-disk dev DB (same path the old store used)."""
    data_dir = os.environ.get(
        "AZIRO_DATA_DIR",
        os.path.join(os.path.dirname(__file__), ".."),
    )
    db_path = os.path.abspath(os.path.join(data_dir, "aziro.db"))
    return f"sqlite:///{db_path}"


def _apply_sqlite_pragmas(dbapi_conn, _conn_record) -> None:
    """Attach to an Engine's `connect` event so WAL + FK + busy_timeout fire
    on every new DBAPI connection without the caller remembering.

    `:memory:` DBs reject WAL silently (journal_mode just stays `memory`),
    which is fine — we still want FK enforcement and the busy_timeout.
    """
    cur = dbapi_conn.cursor()
    try:
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA busy_timeout=5000")
    finally:
        cur.close()


def _check_sqlite_version() -> None:
    """Fail fast with a clear message if the runtime's SQLite predates
    3.35 — save_event/create_user use INSERT ... RETURNING which only
    lands there. Better to surface this at engine build than at the
    first write."""
    actual = tuple(int(x) for x in sqlite3.sqlite_version.split("."))
    if actual < _MIN_SQLITE:
        have = sqlite3.sqlite_version
        need = ".".join(str(x) for x in _MIN_SQLITE)
        raise RuntimeError(
            f"SQLite {have} is too old — Aziro Ops requires ≥ {need} for "
            f"INSERT … RETURNING. Upgrade the OS package (Ubuntu 22.04+, "
            f"Debian 12+, or run via the provided Dockerfile which bases on "
            f"python:3.12-slim)."
        )


def ensure_capable(engine: Engine) -> None:
    """Re-apply the capability checks `build_engine()` performs, for stores
    that accept a pre-built `engine=` injection and would otherwise bypass
    them. No-op for non-SQLite engines.
    """
    if engine.dialect.name == "sqlite":
        _check_sqlite_version()


def build_engine(url: str) -> Engine:
    """Create a fresh Engine for the given URL. Not cached.

    Tests that need an isolated DB (e.g. `EventStore(db_file=tmp/aziro.db)`)
    go through here so one test's state can't leak into another's.
    """
    is_sqlite = url.startswith("sqlite")
    is_memory = is_sqlite and (":memory:" in url or url.endswith("sqlite://"))

    if is_sqlite:
        _check_sqlite_version()

    kwargs: dict = {"future": True}

    if is_sqlite:
        # sqlite3 connections aren't thread-safe; the old store worked around
        # this with a thread-local cache + check_same_thread=False. SA Core's
        # default pool (QueuePool) achieves the same isolation by handing
        # each checkout a connection from the pool — but we still need
        # check_same_thread=False because a gevent greenlet may check a
        # pooled connection back in from a different OS thread than the one
        # that checked it out.
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 5.0}
        if is_memory:
            # :memory: DBs are per-connection, so a pool defeats the point
            # (each new checkout would see an empty DB). StaticPool pins
            # one connection for the life of the engine.
            kwargs["poolclass"] = StaticPool
    else:
        # Postgres / anything else — pool_pre_ping cheaply verifies the
        # connection is alive before handing it back to application code,
        # so a network blip doesn't surface as a mid-request crash.
        kwargs["pool_pre_ping"] = True
        kwargs["pool_size"] = 10
        kwargs["max_overflow"] = 10

    engine = create_engine(url, **kwargs)

    if engine.dialect.name == "sqlite":
        event.listen(engine, "connect", _apply_sqlite_pragmas)

    return engine


def resolve_url() -> str:
    """Pick the URL the process-wide engine should connect to.

    Separated from `get_engine()` so tests and the Alembic env can peek at
    the same resolution logic without having to construct an engine.
    """
    return os.environ.get("AZIRO_DB_URL") or _default_sqlite_url()


def get_engine() -> Engine:
    """Return the process-wide Engine, creating it on first call."""
    global _PROCESS_ENGINE
    with _PROCESS_ENGINE_LOCK:
        if _PROCESS_ENGINE is None:
            _PROCESS_ENGINE = build_engine(resolve_url())
        return _PROCESS_ENGINE


def reset_engine() -> None:
    """Drop the process-wide Engine — tests call this after mutating
    `AZIRO_DB_URL` / `AZIRO_DATA_DIR` so the next `get_engine()` re-resolves.

    Not thread-safe against in-flight queries; only safe to call between
    test cases.
    """
    global _PROCESS_ENGINE
    with _PROCESS_ENGINE_LOCK:
        if _PROCESS_ENGINE is not None:
            _PROCESS_ENGINE.dispose()
        _PROCESS_ENGINE = None
