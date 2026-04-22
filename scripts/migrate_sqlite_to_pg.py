"""
scripts/migrate_sqlite_to_pg.py — one-shot copy from the legacy SQLite file
to a fresh Postgres 16 database during the DB-3 cut-over.

The sequence ops runs on a maintenance window:

    # 1. Bring Postgres up, run migrations, confirm schema is at head.
    docker compose up -d postgres
    AZIRO_DB_URL=postgresql+psycopg://… python -m scripts.db upgrade

    # 2. Rehearse against a copy of the live SQLite file.
    python -m scripts.migrate_sqlite_to_pg --dry-run
    python -m scripts.migrate_sqlite_to_pg --execute
    python -m scripts.migrate_sqlite_to_pg --verify

    # 3. On clean verify, flip the app over by leaving AZIRO_DB_URL set.

Modes (mutually exclusive):
    --dry-run   Count rows in source and target per table. No writes.
    --execute   Copy every row of every table, in a single transaction,
                preserving primary keys so foreign keys still line up.
                Aborts if any target table already has rows (use --force
                to overwrite — destructive, operator must be sure).
    --verify    Compare per-table row counts after the fact. Exits non-zero
                on any mismatch.

Assumptions:
    - Target schema is already at Alembic head (`scripts.db upgrade` ran).
      We copy data only; we do not create tables.
    - Target URL is `postgresql+psycopg://…` (psycopg 3). We refuse to run
      against SQLite-on-SQLite to prevent footguns.
    - Table list comes from `store.schema.metadata.sorted_tables` so FKs
      resolve in dependency order.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Iterable

from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.engine import Engine, make_url

# Ensure the repo root is importable when this file is run directly
# (`python scripts/migrate_sqlite_to_pg.py`) — module-mode (`python -m
# scripts.migrate_sqlite_to_pg`) already has it via the package layout.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from store.schema import metadata  # noqa: E402


# Batch size for per-table copies. 1000 rows/round keeps Postgres memory
# bounded while amortising network round-trips. Bump with --batch-size
# when migrating on a fat link; lower when running against a laptop PG.
_DEFAULT_BATCH = 1000


def _safe_target(url: str) -> str:
    """Mask any password component of a DB URL for stderr/log output.

    Same helper shape as scripts/db.py — duplicated rather than cross-
    imported to keep this script drop-in runnable even if scripts/ is
    restructured later.
    """
    try:
        return make_url(url).render_as_string(hide_password=True)
    except Exception:
        scheme = url.split(":", 1)[0] if ":" in url else "?"
        return f"{scheme}://***"


def _default_source_url() -> str:
    """URL for the legacy on-disk SQLite file. Matches
    `store/engine.py::_default_sqlite_url` — kept in sync by convention,
    not import, because this script must run even if `store.engine`
    evolves its defaults post-migration."""
    data_dir = os.environ.get(
        "AZIRO_DATA_DIR",
        str(_REPO_ROOT),
    )
    db_path = os.path.abspath(os.path.join(data_dir, "aziro.db"))
    return f"sqlite:///{db_path}"


def _ordered_tables():
    """Return tables in FK-safe load order. `metadata.sorted_tables` sorts
    parents before children so INSERTs into `snapshots` (FK → events.id)
    always happen after `events` is populated."""
    return list(metadata.sorted_tables)


def _row_count(engine: Engine, table) -> int:
    """Count rows in a table. Returns 0 if the table does not exist on
    this engine — surfaces as `—` in dry-run output so the operator can
    see which side is missing the table."""
    insp = inspect(engine)
    if not insp.has_table(table.name):
        return -1
    with engine.connect() as conn:
        return int(conn.execute(select(func.count()).select_from(table)).scalar_one())


def _chunked(rows: Iterable[dict], size: int):
    """Yield `rows` in lists of at most `size`. Used to bound the memory
    footprint of each `executemany` round-trip."""
    batch: list[dict] = []
    for row in rows:
        batch.append(row)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def _iter_source_rows(src_engine: Engine, table):
    """Stream rows from the source as plain dicts keyed by column name.
    `stream_results=True` tells SQLAlchemy to use a server-side cursor on
    backends that support it; SQLite ignores the hint harmlessly, which
    is what we want — legacy files stay < 100MB in practice."""
    with src_engine.connect().execution_options(stream_results=True) as conn:
        result = conn.execute(select(table))
        for row in result.mappings():
            yield dict(row)


def _reset_sequences(dst_engine: Engine) -> None:
    """Bump the Postgres sequence for every autoincrement PK past the
    max id we just inserted.

    Non-empty table: `setval(seq, max(id), true)` so the next `nextval`
    returns `max(id) + 1`. Empty table: `setval(seq, 1, false)` so the
    next `nextval` returns 1 — we can't use `setval(seq, 0, true)` here
    because PG sequences default to `MINVALUE 1` and reject 0 with
    `ERROR 22023: setval: value 0 is out of bounds`.

    SQLite has no sequences; the equivalent is `sqlite_sequence` rows that
    INSERT updates automatically, so this function no-ops there. Keeps the
    code path testable against a SQLite target without a live Postgres.
    """
    if dst_engine.dialect.name != "postgresql":
        return
    for table in _ordered_tables():
        pk_cols = [c.name for c in table.primary_key.columns]
        if pk_cols != ["id"]:
            # All our tables have a single autoincrement `id` PK. If that
            # ever changes, add per-table logic before enabling this skip.
            continue
        seq = f"{table.name}_id_seq"
        with dst_engine.begin() as conn:
            max_id = conn.execute(
                text(f"SELECT MAX(id) FROM {table.name}")
            ).scalar()
            if max_id is None:
                conn.execute(text(f"SELECT setval('{seq}', 1, false)"))
            else:
                conn.execute(
                    text(f"SELECT setval('{seq}', :v, true)"),
                    {"v": max_id},
                )


def _assert_target_empty(dst_engine: Engine, force: bool) -> None:
    """Bail before `--execute` unless every table is empty. Prevents the
    common footgun of running the migration twice and ending up with
    duplicate-key errors mid-flight (partial state, half-rolled-back)."""
    for table in _ordered_tables():
        count = _row_count(dst_engine, table)
        if count == -1:
            raise SystemExit(
                f"target table '{table.name}' missing — "
                f"run `python -m scripts.db upgrade` first"
            )
        if count > 0 and not force:
            raise SystemExit(
                f"target table '{table.name}' already has {count} rows — "
                "pass --force to overwrite (destructive)"
            )


def _truncate_target(dst_engine: Engine) -> None:
    """`--force` path: wipe every table before re-populating.

    Postgres: one `TRUNCATE … CASCADE RESTART IDENTITY` — atomic, FK-order
    insensitive, resets sequences.
    SQLite: no TRUNCATE; DELETE in reverse FK order so children go before
    parents (PRAGMA foreign_keys=ON rejects parent-first deletes).
    """
    tables = _ordered_tables()
    if dst_engine.dialect.name == "postgresql":
        names = ", ".join(t.name for t in tables)
        with dst_engine.begin() as conn:
            conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
        return
    with dst_engine.begin() as conn:
        for table in reversed(tables):
            conn.execute(text(f"DELETE FROM {table.name}"))


def cmd_dry_run(src: Engine, dst: Engine) -> int:
    """Print per-table row counts on both sides. No writes."""
    print(f"{'table':<20} {'sqlite':>10} {'postgres':>10}")
    print("-" * 42)
    total_src = 0
    for table in _ordered_tables():
        s = _row_count(src, table)
        d = _row_count(dst, table)
        if s < 0:
            s_str = "—"
        else:
            total_src += s
            s_str = str(s)
        d_str = "—" if d < 0 else str(d)
        print(f"{table.name:<20} {s_str:>10} {d_str:>10}")
    print("-" * 42)
    print(f"source rows to copy: {total_src}")
    return 0


def cmd_execute(src: Engine, dst: Engine, batch_size: int, force: bool) -> int:
    """Copy every row of every table from SQLite into Postgres.

    Single outer transaction: if any insert raises, the whole migration
    rolls back and the operator is left with an empty target (safe to
    retry). We accept the latency cost of holding one long transaction
    in exchange for all-or-nothing semantics.
    """
    if force:
        print("WARNING: --force given, truncating target before copy")
        _truncate_target(dst)
    else:
        _assert_target_empty(dst, force=False)

    copied_totals: dict[str, int] = {}
    with dst.begin() as dst_conn:
        for table in _ordered_tables():
            src_count = _row_count(src, table)
            if src_count <= 0:
                copied_totals[table.name] = 0
                continue
            print(f"copy {table.name}: {src_count} rows... ", end="", flush=True)
            written = 0
            for batch in _chunked(_iter_source_rows(src, table), batch_size):
                dst_conn.execute(table.insert(), batch)
                written += len(batch)
            copied_totals[table.name] = written
            print(f"done ({written})")

    # Sequences live outside our transaction; reset them after the copy
    # transaction has committed so they reflect the final post-commit max.
    _reset_sequences(dst)

    grand_total = sum(copied_totals.values())
    print(f"migration complete: {grand_total} rows across {len(copied_totals)} tables")
    return 0


def cmd_verify(src: Engine, dst: Engine) -> int:
    """Row-count equality check per table. Exits non-zero on any drift.

    We keep this separate from `--execute` so ops can re-run verify at
    any point during the cut-over window — e.g. after the app has been
    pointed at Postgres but before the SQLite file is archived."""
    bad = 0
    print(f"{'table':<20} {'sqlite':>10} {'postgres':>10} {'status':>10}")
    print("-" * 54)
    for table in _ordered_tables():
        s = _row_count(src, table)
        d = _row_count(dst, table)
        status = "ok" if s == d else "MISMATCH"
        if status == "MISMATCH":
            bad += 1
        print(f"{table.name:<20} {s:>10} {d:>10} {status:>10}")
    print("-" * 54)
    if bad:
        print(f"FAIL: {bad} table(s) drifted")
        return 1
    print("OK: all tables match")
    return 0


def _build_engines(src_url: str, dst_url: str) -> tuple[Engine, Engine]:
    """Construct source + target engines with sane defaults.

    The source (SQLite) uses the default pool. The target (Postgres)
    gets `pool_pre_ping` so a stale connection in the pool surfaces as
    a clean retry instead of a crashed copy.
    """
    src_engine = create_engine(src_url, future=True)
    dst_engine = create_engine(dst_url, future=True, pool_pre_ping=True)
    return src_engine, dst_engine


def _validate_urls(src_url: str, dst_url: str, mode: str) -> None:
    """Fail fast on configurations that are almost certainly wrong.

    `--dry-run` is read-only on both sides so we're lenient; `--execute`
    and `--verify` need a real Postgres target because that's the whole
    point of the cut-over.
    """
    if not src_url.startswith("sqlite"):
        raise SystemExit(
            f"source must be sqlite:// (got {_safe_target(src_url)})"
        )
    if mode in ("execute", "verify"):
        if not dst_url.startswith("postgresql"):
            raise SystemExit(
                f"target must be postgresql:// for --{mode} "
                f"(got {_safe_target(dst_url)})"
            )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="scripts.migrate_sqlite_to_pg")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true",
                       help="print row counts; no writes")
    group.add_argument("--execute", action="store_true",
                       help="copy every row; aborts if target non-empty")
    group.add_argument("--verify", action="store_true",
                       help="compare per-table row counts post-copy")

    parser.add_argument("--source-url",
                        default=_default_source_url(),
                        help="override source SQLite URL")
    parser.add_argument("--target-url",
                        default=os.environ.get("AZIRO_DB_URL", ""),
                        help="override target URL (default: $AZIRO_DB_URL)")
    parser.add_argument("--batch-size", type=int, default=_DEFAULT_BATCH,
                        help=f"rows per executemany round-trip (default {_DEFAULT_BATCH})")
    parser.add_argument("--force", action="store_true",
                        help="TRUNCATE target before --execute (destructive)")

    args = parser.parse_args(argv)

    mode = "dry-run" if args.dry_run else ("execute" if args.execute else "verify")
    src_url = args.source_url
    dst_url = args.target_url
    if not dst_url and mode != "dry-run":
        raise SystemExit(
            "target URL required — set AZIRO_DB_URL or pass --target-url"
        )

    _validate_urls(src_url, dst_url or "sqlite://", mode)

    print(f"[migrate] mode:   {mode}", file=sys.stderr)
    print(f"[migrate] source: {_safe_target(src_url)}", file=sys.stderr)
    print(f"[migrate] target: {_safe_target(dst_url) if dst_url else '(none)'}",
          file=sys.stderr)

    src_engine, dst_engine = _build_engines(
        src_url, dst_url or "sqlite:///:memory:"
    )
    try:
        if args.dry_run:
            return cmd_dry_run(src_engine, dst_engine)
        if args.execute:
            return cmd_execute(src_engine, dst_engine, args.batch_size, args.force)
        return cmd_verify(src_engine, dst_engine)
    finally:
        src_engine.dispose()
        dst_engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
