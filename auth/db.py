"""
auth/db.py — AuthStore: users + login_failures + audit_log, on SQLAlchemy Core.

Shares `store.engine.get_engine()` with `EventStore`, so users / audit
rows land in the same DB file (SQLite) or Postgres database as events —
one backup artefact, one migration chain, one connection pool.

Password hashing: bcrypt via the `bcrypt` package. We explicitly do NOT
use werkzeug.security — it defaults to pbkdf2-sha256 which, while fine,
leaves the work factor up to a library-wide constant. bcrypt with a
configurable cost (default 12) is the industry baseline.
"""
from __future__ import annotations

import datetime
import os
from typing import Optional

import bcrypt
from sqlalchemy import Engine, text
from sqlalchemy.exc import IntegrityError

from store.engine import build_engine, ensure_capable, get_engine
from store.schema import metadata


DB_FILE = os.path.join(
    os.environ.get("AZIRO_DATA_DIR", os.path.join(os.path.dirname(__file__), "..")),
    "aziro.db",
)

# bcrypt cost factor. 12 = ~250ms/hash on modern hardware — slow enough to
# frustrate brute force, fast enough that a login isn't painful.
_BCRYPT_ROUNDS = int(os.environ.get("AZIRO_BCRYPT_ROUNDS", "12"))

# Account lockout — N consecutive failed logins within WINDOW seconds
# triggers a temporary lockout of DURATION seconds.
FAILED_LOGIN_LIMIT    = int(os.environ.get("AZIRO_LOGIN_FAIL_LIMIT",    "5"))
FAILED_LOGIN_WINDOW   = int(os.environ.get("AZIRO_LOGIN_FAIL_WINDOW",   "300"))
FAILED_LOGIN_LOCKOUT  = int(os.environ.get("AZIRO_LOGIN_FAIL_LOCKOUT",  "900"))

# Password policy — minimum length enforced at creation time.
MIN_PASSWORD_LEN = int(os.environ.get("AZIRO_MIN_PASSWORD_LEN", "12"))

# Module-level dummy hash for constant-time login. Generating salts inside
# verify_password for missing users would use `gensalt(rounds=4)` which is
# much faster than `_BCRYPT_ROUNDS` and gives attackers a timing oracle
# for "does this username exist". Precomputing at import (at the real cost)
# makes checkpw(b"x", _DUMMY_HASH) match the timing of a real check.
_DUMMY_HASH = bcrypt.hashpw(b"x", bcrypt.gensalt(rounds=_BCRYPT_ROUNDS))


def _now() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


class AuthStore:
    def __init__(self, db_file: Optional[str] = None, engine: Optional[Engine] = None):
        if engine is not None:
            self._engine = engine
            # `build_engine` runs the SQLite >= 3.35 check; an injected
            # engine skipped it. create_user() uses INSERT … RETURNING id.
            ensure_capable(self._engine)
        elif db_file is not None:
            self._engine = build_engine(f"sqlite:///{os.path.abspath(db_file)}")
        else:
            self._engine = get_engine()
        self._init_schema()

    def _init_schema(self) -> None:
        """Bootstrap auth tables — SQLite only.

        Postgres deployments use Alembic (`python -m scripts.db upgrade
        head`) as the single source of schema truth; running
        `metadata.create_all` on every boot would require the app user
        to hold CREATE grants and could race an in-flight migration.
        On SQLite (dev/test), `create_all` remains the bootstrap path.
        """
        if self._engine.dialect.name == "sqlite":
            metadata.create_all(self._engine)

    # ── users ────────────────────────────────────────────────────────────────

    def count_users(self) -> int:
        with self._engine.begin() as conn:
            return int(conn.execute(text("SELECT COUNT(*) FROM users")).scalar() or 0)

    def create_user(self, username: str, password: str, role: str = "viewer") -> dict:
        """Create a user. Raises ValueError on weak/invalid input or duplicate."""
        from auth.models import ALL_ROLES
        username = (username or "").strip()
        if not username or len(username) > 64:
            raise ValueError("username must be 1–64 chars")
        if role not in ALL_ROLES:
            raise ValueError(f"role must be one of {sorted(ALL_ROLES)}")
        if not isinstance(password, str) or len(password) < MIN_PASSWORD_LEN:
            raise ValueError(f"password must be ≥ {MIN_PASSWORD_LEN} chars")

        pw_hash = bcrypt.hashpw(
            password.encode("utf-8"),
            bcrypt.gensalt(rounds=_BCRYPT_ROUNDS),
        ).decode("utf-8")

        try:
            with self._engine.begin() as conn:
                uid = conn.execute(
                    text("""INSERT INTO users (username, password_hash, role, created_at)
                            VALUES (:username, :pw, :role, :ts)
                            RETURNING id"""),
                    {"username": username, "pw": pw_hash, "role": role, "ts": _now()},
                ).scalar()
        except IntegrityError as e:
            raise ValueError(f"username {username!r} already exists") from e

        return {"id": int(uid), "username": username, "role": role}

    def get_user(self, user_id: int) -> Optional[dict]:
        with self._engine.begin() as conn:
            row = conn.execute(
                text("""SELECT id, username, role, created_at, last_login_at
                        FROM users WHERE id = :id"""),
                {"id": user_id},
            ).mappings().first()
        return dict(row) if row else None

    def get_user_by_name(self, username: str) -> Optional[dict]:
        with self._engine.begin() as conn:
            row = conn.execute(
                text("""SELECT id, username, password_hash, role, created_at, last_login_at
                        FROM users WHERE username = :u"""),
                {"u": (username or "").strip()},
            ).mappings().first()
        return dict(row) if row else None

    def verify_password(self, username: str, password: str) -> Optional[dict]:
        """Return the user dict on success, None on failure. Constant-time."""
        row = self.get_user_by_name(username)
        if not row:
            # Constant-time: verify against the module-level dummy hash
            # (computed at the real _BCRYPT_ROUNDS cost) so the response
            # timing doesn't reveal whether the username exists.
            bcrypt.checkpw(b"x", _DUMMY_HASH)
            return None
        try:
            ok = bcrypt.checkpw(
                password.encode("utf-8"),
                row["password_hash"].encode("utf-8"),
            )
        except (ValueError, TypeError):
            ok = False
        if not ok:
            return None
        return {"id": row["id"], "username": row["username"], "role": row["role"]}

    def record_login_success(self, user_id: int) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                text("UPDATE users SET last_login_at = :ts WHERE id = :id"),
                {"ts": _now(), "id": user_id},
            )

    def record_login_failure(self, username: str, remote_ip: str = "") -> None:
        with self._engine.begin() as conn:
            conn.execute(
                text("""INSERT INTO login_failures (username, timestamp, remote_ip)
                        VALUES (:u, :ts, :ip)"""),
                {"u": (username or "").strip(), "ts": _now(), "ip": remote_ip or ""},
            )

    def is_locked_out(self, username: str) -> bool:
        """True if `username` has ≥ FAILED_LOGIN_LIMIT failures in the last
        FAILED_LOGIN_WINDOW seconds AND the most recent failure is within
        FAILED_LOGIN_LOCKOUT seconds."""
        username = (username or "").strip()
        if not username:
            return False
        window_cutoff = (datetime.datetime.now()
                         - datetime.timedelta(seconds=FAILED_LOGIN_WINDOW)
                         ).isoformat(timespec="seconds")
        with self._engine.begin() as conn:
            rows = conn.execute(
                text("""SELECT timestamp FROM login_failures
                        WHERE username = :u AND timestamp >= :cutoff
                        ORDER BY timestamp DESC LIMIT :limit"""),
                {"u": username, "cutoff": window_cutoff, "limit": FAILED_LOGIN_LIMIT},
            ).mappings().all()
        if len(rows) < FAILED_LOGIN_LIMIT:
            return False
        latest = datetime.datetime.fromisoformat(rows[0]["timestamp"])
        return (datetime.datetime.now() - latest
                ).total_seconds() < FAILED_LOGIN_LOCKOUT

    def clear_login_failures(self, username: str) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                text("DELETE FROM login_failures WHERE username = :u"),
                {"u": (username or "").strip()},
            )

    # ── audit log ────────────────────────────────────────────────────────────

    def write_audit(self, *, user_id: Optional[int], username: str, action: str,
                    target: str = "", status: int = 0, remote_ip: str = "",
                    request_id: str = "") -> None:
        with self._engine.begin() as conn:
            conn.execute(
                text("""INSERT INTO audit_log
                        (timestamp, user_id, username, action, target,
                         status, remote_ip, request_id)
                        VALUES (:ts, :user_id, :username, :action, :target,
                                :status, :remote_ip, :request_id)"""),
                {
                    "ts":         _now(),
                    "user_id":    user_id,
                    "username":   username or "",
                    "action":     action,
                    "target":     target or "",
                    "status":     int(status) if status else 0,
                    "remote_ip":  remote_ip or "",
                    "request_id": request_id or "",
                },
            )

    def recent_audit(self, limit: int = 100) -> list:
        with self._engine.begin() as conn:
            rows = conn.execute(
                text("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT :limit"),
                {"limit": limit},
            ).mappings().all()
        return [dict(r) for r in rows]
