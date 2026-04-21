"""
scripts/db.py — thin wrapper around Alembic so operators don't need to
memorise CLI invocations.

Usage:
    python -m scripts.db upgrade [revision]   # default: head
    python -m scripts.db downgrade <revision>
    python -m scripts.db current
    python -m scripts.db history

All commands honour `AZIRO_DB_URL` just like the running app does.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url


def _safe_target(url: str) -> str:
    """Return a URL string with any password component masked.

    AZIRO_DB_URL frequently embeds `user:password@host/db` for Postgres;
    echoing it raw to stderr leaks credentials into CI logs and shell
    history. SQLAlchemy's `URL.render_as_string(hide_password=True)`
    replaces the password with `***` while keeping the rest readable.
    """
    try:
        return make_url(url).render_as_string(hide_password=True)
    except Exception:
        # Fall back to scheme-only on parse failure — never log raw.
        scheme = url.split(":", 1)[0] if ":" in url else "?"
        return f"{scheme}://***"


def _load_config() -> Config:
    """Resolve alembic.ini at the repo root regardless of cwd."""
    repo_root = Path(__file__).resolve().parent.parent
    ini = repo_root / "alembic.ini"
    if not ini.exists():
        raise FileNotFoundError(f"alembic.ini not found at {ini}")
    cfg = Config(str(ini))
    # Keep cwd-relative script_location sane.
    cfg.set_main_option("script_location", str(repo_root / "alembic"))
    return cfg


def _cmd_upgrade(args: argparse.Namespace) -> int:
    command.upgrade(_load_config(), args.revision)
    return 0


def _cmd_downgrade(args: argparse.Namespace) -> int:
    command.downgrade(_load_config(), args.revision)
    return 0


def _cmd_current(_: argparse.Namespace) -> int:
    command.current(_load_config(), verbose=True)
    return 0


def _cmd_history(_: argparse.Namespace) -> int:
    command.history(_load_config(), verbose=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="scripts.db")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_up = sub.add_parser("upgrade", help="Apply migrations up to REV (default: head)")
    p_up.add_argument("revision", nargs="?", default="head")
    p_up.set_defaults(func=_cmd_upgrade)

    p_down = sub.add_parser("downgrade", help="Roll back to REV")
    p_down.add_argument("revision")
    p_down.set_defaults(func=_cmd_downgrade)

    sub.add_parser("current", help="Show current DB revision") \
        .set_defaults(func=_cmd_current)
    sub.add_parser("history", help="Show migration history") \
        .set_defaults(func=_cmd_history)

    args = parser.parse_args(argv)
    raw = os.environ.get("AZIRO_DB_URL")
    shown = _safe_target(raw) if raw else "sqlite (default)"
    print(f"[scripts.db] target: {shown}", file=sys.stderr)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
