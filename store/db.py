"""
store/db.py — SQLite event store for Aziro Ops.

Three tables:
  events     — every alert that fired (timestamp, level, reason, object)
  snapshots  — kubectl logs/describe captured the moment an event fires
  analyses   — what the AI diagnosed + any remediation proposed

Auto-purges events older than RETENTION_DAYS (default 30) on each save_event call.
"""
import sqlite3
import json
import os
import datetime

DB_FILE        = os.path.join(
    os.environ.get("AZIRO_DATA_DIR", os.path.join(os.path.dirname(__file__), "..")),
    "aziro.db",
)
RETENTION_DAYS = 30


class EventStore:
    """
    SQLite-backed store for monitor events, log snapshots, and AI analyses.

    Usage
    -----
        store = EventStore()
        eid   = store.save_event(event, "SEV2")
        store.save_snapshot(eid, "logs", kubectl_output)
        store.save_analysis(eid, diagnosis="OOMKilled — memory limit too low")
    """

    def __init__(self, db_file=DB_FILE):
        self._db = db_file
        self._init_schema()
        self._migrate()

    # ── schema ────────────────────────────────────────────────────────────────

    def _init_schema(self):
        with self._conn() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS events (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT    NOT NULL,
                    source    TEXT    NOT NULL DEFAULT 'kubernetes',
                    level     TEXT    NOT NULL,
                    reason    TEXT    NOT NULL,
                    object    TEXT    NOT NULL,
                    namespace TEXT    DEFAULT '',
                    message   TEXT    DEFAULT '',
                    status    TEXT    NOT NULL DEFAULT 'open',
                    raw       TEXT    DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS snapshots (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
                    timestamp TEXT    NOT NULL,
                    kind      TEXT    NOT NULL,
                    content   TEXT    DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS analyses (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
                    timestamp   TEXT    NOT NULL,
                    diagnosis   TEXT    DEFAULT '',
                    remediation TEXT    DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS metrics (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    target_id TEXT    NOT NULL,
                    timestamp TEXT    NOT NULL,
                    metric    TEXT    NOT NULL,
                    value     REAL    NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_events_object    ON events(object);
                CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_events_level     ON events(level);
                CREATE TABLE IF NOT EXISTS feedback (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp  TEXT NOT NULL,
                    target_id  TEXT NOT NULL,
                    message    TEXT NOT NULL,
                    rating     TEXT NOT NULL,
                    comment    TEXT DEFAULT ''
                );

                CREATE INDEX IF NOT EXISTS idx_metrics_target_time
                    ON metrics(target_id, metric, timestamp DESC);
                PRAGMA foreign_keys = ON;
            """)

    def _migrate(self):
        """Add columns introduced after initial schema without dropping existing data."""
        migrations = [
            "ALTER TABLE events ADD COLUMN status TEXT NOT NULL DEFAULT 'open'",
            "ALTER TABLE events ADD COLUMN target_id TEXT DEFAULT ''",
            "ALTER TABLE events ADD COLUMN target_name TEXT DEFAULT ''",
        ]
        for sql in migrations:
            try:
                with self._conn() as c:
                    c.execute(sql)
            except Exception:
                pass  # column already exists

    def _conn(self):
        conn = sqlite3.connect(self._db, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")    # safe concurrent reads
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    # ── write ─────────────────────────────────────────────────────────────────

    def save_event(self, event: dict, level: str,
                   target_id: str = "", target_name: str = "") -> int:
        """
        Persist a monitor event. Returns the new event id.
        Also purges events older than RETENTION_DAYS.
        """
        now = _now()
        with self._conn() as c:
            cur = c.execute(
                """INSERT INTO events
                   (timestamp, source, level, reason, object, namespace, message, raw, target_id, target_name)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (now,
                 event.get("source",    "kubernetes"),
                 level,
                 event.get("reason",    ""),
                 event.get("object",    ""),
                 event.get("namespace", ""),
                 event.get("message",   ""),
                 json.dumps(event),
                 target_id,
                 target_name),
            )
            eid = cur.lastrowid

        self._purge_old()
        return eid

    def update_event_status(self, event_id: int, status: str) -> bool:
        """Update event status: open | acknowledged | resolved"""
        valid = {"open", "acknowledged", "resolved"}
        if status not in valid:
            return False
        with self._conn() as c:
            c.execute("UPDATE events SET status = ? WHERE id = ?", (status, event_id))
        return True

    def save_snapshot(self, event_id: int, kind: str, content: str):
        """
        Save a kubectl log/describe snapshot linked to an event.

        kind values: logs | logs_previous | describe | events
        """
        with self._conn() as c:
            c.execute(
                "INSERT INTO snapshots (event_id, timestamp, kind, content) VALUES (?,?,?,?)",
                (event_id, _now(), kind, content or ""),
            )

    def save_analysis(self, event_id: int, diagnosis: str, remediation: str = ""):
        """Save the AI diagnosis (and optional remediation command) for an event."""
        with self._conn() as c:
            c.execute(
                """INSERT INTO analyses (event_id, timestamp, diagnosis, remediation)
                   VALUES (?,?,?,?)""",
                (event_id, _now(), diagnosis[:8000], remediation[:2000]),
            )

    # ── read ──────────────────────────────────────────────────────────────────

    def get_events(self, limit: int = 50, level: str = None,
                   object_name: str = None) -> list:
        """Return recent events with last_diagnosis, optionally filtered."""
        where  = []
        params = []
        if level:
            where.append("e.level = ?")
            params.append(level)
        if object_name:
            where.append("e.object LIKE ?")
            params.append(f"%{object_name}%")

        where_clause = ("WHERE " + " AND ".join(where)) if where else ""
        sql = f"""
            SELECT e.*,
                   (SELECT a.diagnosis FROM analyses a
                    WHERE  a.event_id = e.id
                    ORDER  BY a.timestamp DESC LIMIT 1) AS last_diagnosis
            FROM   events e
            {where_clause}
            ORDER  BY e.timestamp DESC
            LIMIT  ?
        """
        params.append(limit)

        with self._conn() as c:
            return [dict(r) for r in c.execute(sql, params).fetchall()]

    def get_event(self, event_id: int) -> dict | None:
        """Return one event with its snapshots and analyses."""
        with self._conn() as c:
            row = c.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
            if not row:
                return None
            event = dict(row)
            event["snapshots"] = [
                dict(r) for r in c.execute(
                    "SELECT * FROM snapshots WHERE event_id = ? ORDER BY timestamp",
                    (event_id,),
                ).fetchall()
            ]
            event["analyses"] = [
                dict(r) for r in c.execute(
                    "SELECT * FROM analyses WHERE event_id = ? ORDER BY timestamp",
                    (event_id,),
                ).fetchall()
            ]
        return event

    def get_object_history(self, object_name: str, limit: int = 10) -> list:
        """
        Return recent events for a specific pod/node,
        with the latest AI diagnosis attached to each row.
        """
        sql = """
            SELECT e.*,
                   (SELECT a.diagnosis FROM analyses a
                    WHERE  a.event_id = e.id
                    ORDER  BY a.timestamp DESC LIMIT 1) AS last_diagnosis
            FROM   events e
            WHERE  e.object = ?
            ORDER  BY e.timestamp DESC
            LIMIT  ?
        """
        with self._conn() as c:
            return [dict(r) for r in c.execute(sql, (object_name, limit)).fetchall()]

    def get_stats(self) -> dict:
        """
        Returns:
          counts      — {SEV1: n, SEV2: n, SEV3: n}
          top_failing — top 10 objects by SEV1/SEV2 event count
          recent      — last 5 events
        """
        with self._conn() as c:
            counts = {
                row[0]: row[1]
                for row in c.execute(
                    "SELECT level, COUNT(*) FROM events GROUP BY level"
                ).fetchall()
            }
            top_failing = [
                dict(r) for r in c.execute(
                    """SELECT object, namespace,
                              COUNT(*)        AS count,
                              MAX(timestamp)  AS last_seen,
                              MAX(level)      AS worst_level
                       FROM   events
                       WHERE  level IN ('SEV1','SEV2')
                       GROUP  BY object
                       ORDER  BY count DESC
                       LIMIT  10"""
                ).fetchall()
            ]
            recent = [
                dict(r) for r in c.execute(
                    "SELECT * FROM events ORDER BY timestamp DESC LIMIT 5"
                ).fetchall()
            ]
        return {"counts": counts, "top_failing": top_failing, "recent": recent}

    # ── metrics ───────────────────────────────────────────────────────────────

    def save_metrics(self, target_id: str, metrics: list):
        """Save a batch of metric readings. Each item: {metric: str, value: float}"""
        now = _now()
        with self._conn() as c:
            c.executemany(
                "INSERT INTO metrics (target_id, timestamp, metric, value) VALUES (?,?,?,?)",
                [(target_id, now, m["metric"], m["value"]) for m in metrics],
            )

    def get_metrics(self, target_id: str, metric: str = None,
                    since: str = None, step: str = None) -> dict:
        """Query metric time-series. Returns {metric_name: [{t, v}, ...]}"""
        where = ["target_id = ?"]
        params = [target_id]
        if metric:
            metrics_list = [m.strip() for m in metric.split(",")]
            where.append(f"metric IN ({','.join('?' * len(metrics_list))})")
            params.extend(metrics_list)
        if since:
            where.append("timestamp >= ?")
            params.append(since)

        sql = f"""
            SELECT metric, timestamp, value
            FROM   metrics
            WHERE  {' AND '.join(where)}
            ORDER  BY timestamp ASC
        """
        result = {}
        with self._conn() as c:
            for row in c.execute(sql, params).fetchall():
                m = row["metric"]
                if m not in result:
                    result[m] = []
                result[m].append({"t": row["timestamp"], "v": row["value"]})
        return result

    def purge_old_metrics(self, days: int = 7):
        """Delete metrics older than N days."""
        cutoff = (
            datetime.datetime.now() - datetime.timedelta(days=days)
        ).isoformat()
        with self._conn() as c:
            c.execute("DELETE FROM metrics WHERE timestamp < ?", (cutoff,))

    # ── feedback ──────────────────────────────────────────────────────────────

    def save_feedback(self, target_id: str, message: str, rating: str, comment: str = ""):
        """Save user feedback (thumbs up/down) for an AI response."""
        with self._conn() as c:
            c.execute(
                "INSERT INTO feedback (timestamp, target_id, message, rating, comment) VALUES (?,?,?,?,?)",
                (_now(), target_id, message[:2000], rating, comment[:500]),
            )

    # ── maintenance ───────────────────────────────────────────────────────────

    def _purge_old(self) -> int:
        """Delete events (+ cascaded snapshots/analyses) older than RETENTION_DAYS."""
        cutoff = (
            datetime.datetime.now() - datetime.timedelta(days=RETENTION_DAYS)
        ).isoformat()
        with self._conn() as c:
            old = [
                r[0] for r in c.execute(
                    "SELECT id FROM events WHERE timestamp < ?", (cutoff,)
                ).fetchall()
            ]
            if old:
                ph = ",".join("?" * len(old))
                c.execute(f"DELETE FROM events WHERE id IN ({ph})", old)
        return len(old)


# ── helper ────────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")
