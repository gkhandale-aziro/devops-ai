"""
auth/db.py — AuthStore: users + audit_log tables on the shared aziro.db.

Why a separate Store (instead of adding methods to EventStore)?
- EventStore is focused on monitor events. Mixing auth + events into one
  class couples two independent concerns and makes the unit tests harder.
- Tables still live in the same sqlite file so we get one backup artifact,
  one WAL file, and one busy_timeout policy.

Password hashing: bcrypt via the `bcrypt` package. We explicitly do NOT
use werkzeug.security — it defaults to pbkdf2-sha256 which, while fine,
leaves the work factor up to a library-wide constant. bcrypt with a
configurable cost (default 12) is the industry baseline.
"""
from __future__ import annotations

import datetime
import os
import sqlite3
import threading
from typing import Optional

import bcrypt


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
    def __init__(self, db_file: str = DB_FILE):
        self._db  = db_file
        self._tls = threading.local()
        self._init_schema()

    def _conn(self):
        conn = getattr(self._tls, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self._db, check_same_thread=False, timeout=5.0)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=5000")
            self._tls.conn = conn
        return conn

    def _init_schema(self):
        with self._conn() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id             INTEGER PRIMARY KEY AUTOINCREMENT,
                    username       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
                    password_hash  TEXT    NOT NULL,
                    role           TEXT    NOT NULL DEFAULT 'viewer',
                    created_at     TEXT    NOT NULL,
                    last_login_at  TEXT    DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS login_failures (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    username   TEXT    NOT NULL COLLATE NOCASE,
                    timestamp  TEXT    NOT NULL,
                    remote_ip  TEXT    DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_login_failures_username_ts
                    ON login_failures(username, timestamp DESC);

                CREATE TABLE IF NOT EXISTS audit_log (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp   TEXT    NOT NULL,
                    user_id     INTEGER,
                    username    TEXT    DEFAULT '',
                    action      TEXT    NOT NULL,
                    target      TEXT    DEFAULT '',
                    status      INTEGER,
                    remote_ip   TEXT    DEFAULT '',
                    request_id  TEXT    DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_audit_log_ts
                    ON audit_log(timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_log_user_ts
                    ON audit_log(user_id, timestamp DESC);
            """)

    # ── users ────────────────────────────────────────────────────────────────

    def count_users(self) -> int:
        with self._conn() as c:
            (n,) = c.execute("SELECT COUNT(*) FROM users").fetchone()
            return n

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
            with self._conn() as c:
                cur = c.execute(
                    "INSERT INTO users (username, password_hash, role, created_at) "
                    "VALUES (?, ?, ?, ?)",
                    (username, pw_hash, role, _now()),
                )
                uid = cur.lastrowid
        except sqlite3.IntegrityError as e:
            raise ValueError(f"username {username!r} already exists") from e

        return {"id": uid, "username": username, "role": role}

    def get_user(self, user_id: int) -> Optional[dict]:
        with self._conn() as c:
            row = c.execute(
                "SELECT id, username, role, created_at, last_login_at "
                "FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            return dict(row) if row else None

    def get_user_by_name(self, username: str) -> Optional[dict]:
        with self._conn() as c:
            row = c.execute(
                "SELECT id, username, password_hash, role, created_at, last_login_at "
                "FROM users WHERE username = ?", ((username or "").strip(),)
            ).fetchone()
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

    def record_login_success(self, user_id: int):
        with self._conn() as c:
            c.execute("UPDATE users SET last_login_at = ? WHERE id = ?",
                      (_now(), user_id))

    def record_login_failure(self, username: str, remote_ip: str = ""):
        with self._conn() as c:
            c.execute(
                "INSERT INTO login_failures (username, timestamp, remote_ip) "
                "VALUES (?, ?, ?)",
                ((username or "").strip(), _now(), remote_ip or ""),
            )

    def is_locked_out(self, username: str) -> bool:
        """True if `username` has ≥ FAILED_LOGIN_LIMIT failures in the last
        FAILED_LOGIN_WINDOW and the most recent failure is within
        FAILED_LOGIN_LOCKOUT seconds."""
        username = (username or "").strip()
        if not username:
            return False
        window_cutoff = (datetime.datetime.now()
                         - datetime.timedelta(seconds=FAILED_LOGIN_WINDOW)
                         ).isoformat(timespec="seconds")
        with self._conn() as c:
            rows = c.execute(
                "SELECT timestamp FROM login_failures "
                "WHERE username = ? AND timestamp >= ? "
                "ORDER BY timestamp DESC LIMIT ?",
                (username, window_cutoff, FAILED_LOGIN_LIMIT),
            ).fetchall()
        if len(rows) < FAILED_LOGIN_LIMIT:
            return False
        # Only locked out if the MOST recent failure is still within the
        # lockout window. Past the window, fresh attempts are allowed.
        latest = datetime.datetime.fromisoformat(rows[0]["timestamp"])
        return (datetime.datetime.now() - latest
                ).total_seconds() < FAILED_LOGIN_LOCKOUT

    def clear_login_failures(self, username: str):
        with self._conn() as c:
            c.execute("DELETE FROM login_failures WHERE username = ?",
                      ((username or "").strip(),))

    # ── audit log ────────────────────────────────────────────────────────────

    def write_audit(self, *, user_id: Optional[int], username: str, action: str,
                    target: str = "", status: int = 0, remote_ip: str = "",
                    request_id: str = ""):
        with self._conn() as c:
            c.execute(
                "INSERT INTO audit_log "
                "(timestamp, user_id, username, action, target, status, remote_ip, request_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (_now(), user_id, username or "", action, target or "",
                 int(status) if status else 0, remote_ip or "", request_id or ""),
            )

    def recent_audit(self, limit: int = 100) -> list:
        with self._conn() as c:
            return [dict(r) for r in c.execute(
                "SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?",
                (limit,),
            ).fetchall()]
