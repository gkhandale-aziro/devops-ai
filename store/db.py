"""
store/db.py — event store for Aziro Ops, now on SQLAlchemy Core.

Same public surface as before:
    store = EventStore()                     # uses AZIRO_DB_URL or default SQLite
    store = EventStore(db_file=".../x.db")   # isolated SQLite path (tests)
    eid = store.save_event({...}, "SEV2")
    store.save_snapshot(eid, "logs", output)
    store.save_analysis(eid, diagnosis, remediation)

Under the hood it runs against a SQLAlchemy Engine (SQLite by default,
Postgres when `AZIRO_DB_URL=postgresql+psycopg://…` is set). SQL is
still written by hand via `text()` — no ORM — because the queries here
are short, selective, and any abstraction would obscure more than it
helped.

Auto-purges events older than `AZIRO_EVENT_RETENTION_DAYS` (default 30)
on each `save_event`. Snapshot + analysis rows cascade via FK.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import logging
import os
from contextlib import contextmanager
from typing import Iterator, Optional

from sqlalchemy import Engine, text
from sqlalchemy.engine import Connection

from sandbox.redact import redact_text
from store.engine import build_engine, get_engine
from store.schema import metadata

log = logging.getLogger(__name__)


DB_FILE = os.path.join(
    os.environ.get("AZIRO_DATA_DIR", os.path.join(os.path.dirname(__file__), "..")),
    "aziro.db",
)


def _retention_days() -> int:
    """Days to keep events (snapshots + analyses cascade via FK).

    Read fresh each call so tests can set AZIRO_EVENT_RETENTION_DAYS=0 to
    force-purge without monkey-patching. Falls back to 30 on a missing,
    malformed, or negative value — a negative window would push the
    cutoff into the future and wipe every row, which is never what an
    operator actually wants.
    """
    try:
        days = int(os.environ.get("AZIRO_EVENT_RETENTION_DAYS", "30"))
    except ValueError:
        return 30
    if days < 0:
        return 30
    return days


def _redact_enabled() -> bool:
    """SEC-6: scrub secrets out of stored snapshot/analysis text.

    On by default. Opt-out via AZIRO_SNAPSHOT_REDACT=0 for scenarios where
    the rule set over-matches (e.g. a customer reproducing a bug against
    a sandbox cluster with fake credentials).
    """
    return os.environ.get("AZIRO_SNAPSHOT_REDACT", "1") not in ("0", "false", "False", "")


# Kept for backward compat with callers that imported this constant.
# New code should use _retention_days().
RETENTION_DAYS = 30


class EventStore:
    """SQL-backed store for monitor events, log snapshots, and AI analyses."""

    def __init__(self, db_file: Optional[str] = None, engine: Optional[Engine] = None):
        if engine is not None:
            self._engine = engine
        elif db_file is not None:
            # Back-compat: callers (mostly tests) that pass an explicit file
            # path get their own engine so test isolation is preserved.
            self._engine = build_engine(f"sqlite:///{os.path.abspath(db_file)}")
        else:
            self._engine = get_engine()
        self._init_schema()
        self._migrate()

    # ── schema ────────────────────────────────────────────────────────────────

    def _init_schema(self) -> None:
        """Create every table in `store.schema.metadata` if missing.

        Idempotent — running against an already-populated DB is a no-op
        because `create_all` passes `checkfirst=True` by default.
        """
        metadata.create_all(self._engine)

    def _migrate(self) -> None:
        """Idempotent ALTER TABLE ADD COLUMN for pre-PR-A SQLite files.

        Fresh installs from `metadata.create_all` already have every
        column the current app needs, so these ALTER statements either
        succeed on a legacy DB or raise `duplicate column` which we
        swallow. Postgres fresh installs also land on the full schema.

        Only the "already exists" path is swallowed — a locked DB,
        permission issue, or unrelated SQL drift must propagate so
        startup fails loudly instead of limping along with a partially
        migrated schema.
        """
        migrations = [
            "ALTER TABLE events ADD COLUMN status TEXT NOT NULL DEFAULT 'open'",
            "ALTER TABLE events ADD COLUMN target_id TEXT DEFAULT ''",
            "ALTER TABLE events ADD COLUMN target_name TEXT DEFAULT ''",
        ]
        for sql in migrations:
            try:
                with self._engine.begin() as conn:
                    conn.execute(text(sql))
            except Exception as e:
                # SQLite: "duplicate column name: status"
                # Postgres: "column ... already exists"
                msg = str(e).lower()
                if "duplicate column" in msg or "already exists" in msg:
                    continue
                raise

    @contextmanager
    def _conn(self) -> Iterator[Connection]:
        """Yield a SA Connection inside an auto-committing transaction.

        Name kept for back-compat with the pre-SA Core code shape. Call
        sites do `with self._conn() as c: c.execute(text(...))`.
        """
        with self._engine.begin() as conn:
            yield conn

    # ── write ─────────────────────────────────────────────────────────────────

    def save_event(self, event: dict, level: str,
                   target_id: str = "", target_name: str = "") -> int:
        """Persist a monitor event. Returns the new event id.

        Also purges events older than RETENTION_DAYS.
        """
        now = _now()
        with self._engine.begin() as conn:
            # RETURNING is the only race-free way to retrieve the new id
            # under concurrent writes — Postgres doesn't expose lastrowid,
            # and a MAX(id) lookup can see another session's row slip in
            # between our INSERT and the SELECT. Both SQLite (>=3.35) and
            # Postgres support RETURNING, so this one path covers both.
            eid = conn.execute(
                text("""INSERT INTO events
                        (timestamp, source, level, reason, object, namespace,
                         message, raw, target_id, target_name)
                        VALUES (:timestamp, :source, :level, :reason, :object,
                                :namespace, :message, :raw, :target_id, :target_name)
                        RETURNING id"""),
                {
                    "timestamp":   now,
                    "source":      event.get("source",    "kubernetes"),
                    "level":       level,
                    "reason":      event.get("reason",    ""),
                    "object":      event.get("object",    ""),
                    "namespace":   event.get("namespace", ""),
                    "message":     event.get("message",   ""),
                    "raw":         json.dumps(event),
                    "target_id":   target_id,
                    "target_name": target_name,
                },
            ).scalar()

        # The row is durable at this point. Purge is a background-style
        # housekeeping task — if it fails (DB locked, disk full, etc.)
        # the caller must NOT see it as `save_event` failure, or they'll
        # retry and end up with a duplicate event. Log so ops notices
        # before retention actually overflows.
        try:
            self._purge_old()
        except Exception as e:
            log.warning("store.purge_old_failed", extra={"err": str(e)[:200]})
        return int(eid)

    def update_event_status(self, event_id: int, status: str) -> bool:
        """Update event status: open | acknowledged | resolved.

        Returns True only when a row was actually updated — a caller
        passing a non-existent event_id gets False so they can surface
        a 404 instead of a misleading 200.
        """
        valid = {"open", "acknowledged", "resolved"}
        if status not in valid:
            return False
        with self._engine.begin() as conn:
            result = conn.execute(
                text("UPDATE events SET status = :status WHERE id = :id"),
                {"status": status, "id": event_id},
            )
        return (result.rowcount or 0) > 0

    def save_snapshot(self, event_id: int, kind: str, content: str) -> None:
        """Save a kubectl log/describe snapshot linked to an event.

        `kind` ∈ {logs, logs_previous, describe, events}.

        Secrets in `content` (AWS keys, JWTs, bearer tokens, etc.) are
        scrubbed via `sandbox.redact.redact_text` before persistence —
        the single choke point for all snapshot writers, so no caller
        can bypass it by forgetting to scrub upstream.
        """
        payload = content or ""
        if _redact_enabled():
            payload = redact_text(payload)
        with self._engine.begin() as conn:
            conn.execute(
                text("""INSERT INTO snapshots (event_id, timestamp, kind, content)
                        VALUES (:event_id, :timestamp, :kind, :content)"""),
                {"event_id": event_id, "timestamp": _now(), "kind": kind, "content": payload},
            )

    def save_analysis(self, event_id: int, diagnosis: str, remediation: str = "") -> None:
        """Save the AI diagnosis (and optional remediation command) for an event.

        Order matters: redact BEFORE truncating. Cutting first can split a
        secret across the 8000/2000-char boundary, leaving its prefix
        un-detectable by any pattern and defeating the scrub.
        """
        if _redact_enabled():
            diag = redact_text(diagnosis)[:8000]
            remed = redact_text(remediation)[:2000]
        else:
            diag = diagnosis[:8000]
            remed = remediation[:2000]
        with self._engine.begin() as conn:
            conn.execute(
                text("""INSERT INTO analyses
                        (event_id, timestamp, diagnosis, remediation)
                        VALUES (:event_id, :timestamp, :diagnosis, :remediation)"""),
                {
                    "event_id":    event_id,
                    "timestamp":   _now(),
                    "diagnosis":   diag,
                    "remediation": remed,
                },
            )

    # ── read ──────────────────────────────────────────────────────────────────

    def get_events(self, limit: int = 50, level: Optional[str] = None,
                   object_name: Optional[str] = None) -> list:
        """Return recent events with last_diagnosis, optionally filtered."""
        where: list[str] = []
        params: dict = {"limit": limit}
        if level:
            where.append("e.level = :level")
            params["level"] = level
        if object_name:
            where.append("e.object LIKE :object_name")
            params["object_name"] = f"%{object_name}%"

        where_clause = ("WHERE " + " AND ".join(where)) if where else ""
        sql = f"""
            SELECT e.*,
                   (SELECT a.diagnosis FROM analyses a
                    WHERE  a.event_id = e.id
                    ORDER  BY a.timestamp DESC LIMIT 1) AS last_diagnosis
            FROM   events e
            {where_clause}
            ORDER  BY e.timestamp DESC
            LIMIT  :limit
        """

        with self._engine.begin() as conn:
            rows = conn.execute(text(sql), params).mappings().all()
        return [dict(r) for r in rows]

    def get_event(self, event_id: int) -> Optional[dict]:
        """Return one event with its snapshots and analyses."""
        with self._engine.begin() as conn:
            row = conn.execute(
                text("SELECT * FROM events WHERE id = :id"),
                {"id": event_id},
            ).mappings().first()
            if not row:
                return None
            event = dict(row)
            event["snapshots"] = [
                dict(r) for r in conn.execute(
                    text("SELECT * FROM snapshots WHERE event_id = :id ORDER BY timestamp"),
                    {"id": event_id},
                ).mappings().all()
            ]
            event["analyses"] = [
                dict(r) for r in conn.execute(
                    text("SELECT * FROM analyses WHERE event_id = :id ORDER BY timestamp"),
                    {"id": event_id},
                ).mappings().all()
            ]
        return event

    def get_object_history(self, object_name: str, limit: int = 10) -> list:
        """Return recent events for a specific pod/node, latest AI diagnosis
        attached."""
        sql = """
            SELECT e.*,
                   (SELECT a.diagnosis FROM analyses a
                    WHERE  a.event_id = e.id
                    ORDER  BY a.timestamp DESC LIMIT 1) AS last_diagnosis
            FROM   events e
            WHERE  e.object = :object_name
            ORDER  BY e.timestamp DESC
            LIMIT  :limit
        """
        with self._engine.begin() as conn:
            rows = conn.execute(text(sql),
                                {"object_name": object_name, "limit": limit}).mappings().all()
        return [dict(r) for r in rows]

    def get_stats(self) -> dict:
        """
        Returns:
          counts      — {SEV1: n, SEV2: n, SEV3: n} — *active issues*, i.e.
                        distinct (object, reason) pairs still open. A
                        crashloop pod that fires 900 events in 9 days
                        counts as ONE active issue, not 900.
          top_failing — top 10 objects by SEV1/SEV2 event count
          recent      — last 5 events
        """
        with self._engine.begin() as conn:
            counts = {
                row[0]: row[1]
                for row in conn.execute(text(
                    """SELECT level, COUNT(DISTINCT object || '|' || reason)
                       FROM   events
                       WHERE  status = 'open'
                       GROUP  BY level"""
                )).all()
            }
            # Postgres requires every non-aggregated SELECT column in
            # GROUP BY (SQLite is lax about this and would silently pick
            # an arbitrary namespace). And `MAX(level)` is severity-
            # inverted — lexically 'SEV2' > 'SEV1', but SEV1 is the more
            # severe of the two, so MAX reports the wrong "worst_level"
            # whenever both appear. MIN() gets the right answer because
            # the level strings happen to sort in severity order, but we
            # use an explicit CASE/bool-or idiom so the intent isn't
            # buried in a lexical coincidence.
            top_failing = [
                dict(r) for r in conn.execute(text(
                    """SELECT object, namespace,
                              COUNT(*)       AS count,
                              MAX(timestamp) AS last_seen,
                              CASE
                                WHEN SUM(CASE WHEN level = 'SEV1' THEN 1 ELSE 0 END) > 0
                                  THEN 'SEV1'
                                ELSE 'SEV2'
                              END            AS worst_level
                       FROM   events
                       WHERE  level IN ('SEV1','SEV2')
                       GROUP  BY object, namespace
                       ORDER  BY count DESC
                       LIMIT  10"""
                )).mappings().all()
            ]
            recent = [
                dict(r) for r in conn.execute(text(
                    "SELECT * FROM events ORDER BY timestamp DESC LIMIT 5"
                )).mappings().all()
            ]
        return {"counts": counts, "top_failing": top_failing, "recent": recent}

    # ── metrics ───────────────────────────────────────────────────────────────

    def save_metrics(self, target_id: str, metrics_list: list) -> None:
        """Save a batch of metric readings. Each item: {metric: str, value: float}."""
        if not metrics_list:
            return
        now = _now()
        rows = [
            {"target_id": target_id, "timestamp": now,
             "metric": m["metric"], "value": m["value"]}
            for m in metrics_list
        ]
        with self._engine.begin() as conn:
            conn.execute(
                text("""INSERT INTO metrics (target_id, timestamp, metric, value)
                        VALUES (:target_id, :timestamp, :metric, :value)"""),
                rows,
            )

    def get_metrics(self, target_id: str, metric: Optional[str] = None,
                    since: Optional[str] = None, step: Optional[str] = None) -> dict:
        """Query metric time-series. Returns {metric_name: [{t, v}, ...]}."""
        where = ["target_id = :target_id"]
        params: dict = {"target_id": target_id}
        if metric:
            metrics_list = [m.strip() for m in metric.split(",")]
            # Build an IN clause with unique bind names.
            in_names = []
            for i, m in enumerate(metrics_list):
                key = f"m{i}"
                in_names.append(f":{key}")
                params[key] = m
            where.append(f"metric IN ({','.join(in_names)})")
        if since:
            where.append("timestamp >= :since")
            params["since"] = since

        sql = f"""
            SELECT metric, timestamp, value
            FROM   metrics
            WHERE  {' AND '.join(where)}
            ORDER  BY timestamp ASC
        """
        result: dict = {}
        with self._engine.begin() as conn:
            for row in conn.execute(text(sql), params).mappings().all():
                m = row["metric"]
                if m not in result:
                    result[m] = []
                result[m].append({"t": row["timestamp"], "v": row["value"]})
        return result

    def purge_old_metrics(self, days: int = 7) -> None:
        """Delete metrics older than N days."""
        cutoff = (
            datetime.datetime.now() - datetime.timedelta(days=days)
        ).isoformat()
        with self._engine.begin() as conn:
            conn.execute(
                text("DELETE FROM metrics WHERE timestamp < :cutoff"),
                {"cutoff": cutoff},
            )

    # ── LLM usage (OPS-4) ─────────────────────────────────────────────────────

    def record_llm_usage(
        self,
        user_id: str,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        session_id: str = "",
    ) -> None:
        """Persist a single LLM call's token usage.

        Fire-and-forget — swallows errors so a persistence blip never masks
        an otherwise-successful LLM response.
        """
        if not user_id:
            return
        # Coerce once at the top — callers occasionally pass strings
        # ("12"/"3") from JSON usage blobs, and `"12" + "3"` silently
        # concatenates instead of summing. Normalize first, THEN sum,
        # so `total` can never disagree with the two components and
        # the blanket except below can't mask a bad-data bug.
        try:
            pt = int(prompt_tokens or 0)
            ct = int(completion_tokens or 0)
        except (TypeError, ValueError):
            log.warning(
                "store.llm_usage_bad_tokens",
                extra={"user_ref": _redact_user(user_id), "model": model,
                       "prompt": repr(prompt_tokens)[:40],
                       "completion": repr(completion_tokens)[:40]},
            )
            return
        total = pt + ct
        try:
            with self._engine.begin() as conn:
                conn.execute(
                    text("""INSERT INTO llm_usage
                            (timestamp, user_id, model, prompt_tokens,
                             completion_tokens, total_tokens, session_id)
                            VALUES (:timestamp, :user_id, :model, :prompt_tokens,
                                    :completion_tokens, :total_tokens, :session_id)"""),
                    {
                        "timestamp":         _now(),
                        "user_id":           user_id,
                        "model":             model,
                        "prompt_tokens":     pt,
                        "completion_tokens": ct,
                        "total_tokens":      total,
                        "session_id":        session_id or "",
                    },
                )
        except Exception as e:
            # Hot path — never raise, but don't silently ghost the row
            # either. Without this log, a persistent write failure
            # (disk full, replica lag, etc.) looks like "budgets just
            # stopped working" with no forensic trail.
            log.warning(
                "store.llm_usage_write_failed",
                extra={"user_ref": _redact_user(user_id), "model": model,
                       "err": str(e)[:200]},
            )

    def user_tokens_today(self, user_id: str) -> int:
        """Return total_tokens this user has spent since today's local midnight.

        Used by the budget-check at request entry. Missing rows (fresh user,
        empty table) return 0 — a brand-new user starts at zero regardless
        of the default.
        """
        if not user_id:
            return 0
        start_of_day = datetime.datetime.combine(
            datetime.date.today(), datetime.time.min
        ).isoformat(timespec="seconds")
        with self._engine.begin() as conn:
            used = conn.execute(
                text("""SELECT COALESCE(SUM(total_tokens), 0) AS used
                        FROM   llm_usage
                        WHERE  user_id = :user_id AND timestamp >= :start"""),
                {"user_id": user_id, "start": start_of_day},
            ).scalar()
        return int(used or 0)

    # ── feedback ──────────────────────────────────────────────────────────────

    def save_feedback(self, target_id: str, message: str, rating: str,
                      comment: str = "") -> None:
        """Save user feedback (thumbs up/down) for an AI response."""
        with self._engine.begin() as conn:
            conn.execute(
                text("""INSERT INTO feedback
                        (timestamp, target_id, message, rating, comment)
                        VALUES (:timestamp, :target_id, :message, :rating, :comment)"""),
                {
                    "timestamp": _now(),
                    "target_id": target_id,
                    "message":   message[:2000],
                    "rating":    rating,
                    "comment":   comment[:500],
                },
            )

    # ── maintenance ───────────────────────────────────────────────────────────

    def _purge_old(self) -> int:
        """Delete events (+ cascaded snapshots/analyses) older than retention.

        Cutoff precision must match `_now()` — stored timestamps are at
        second precision, so a cutoff with microseconds would compare as
        strictly greater than a just-saved row, letting retention=0 purge
        a row inserted microseconds earlier in the same `save_event` call.
        """
        cutoff = (
            datetime.datetime.now() - datetime.timedelta(days=_retention_days())
        ).isoformat(timespec="seconds")
        with self._engine.begin() as conn:
            result = conn.execute(
                text("DELETE FROM events WHERE timestamp < :cutoff"),
                {"cutoff": cutoff},
            )
            return int(result.rowcount or 0)


# ── helper ────────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


def _redact_user(user_id: str) -> str:
    """Stable short hash for log telemetry so a persistent user's failures
    still correlate across log lines, without spilling a raw username
    (which may be an email or account key) into log aggregation.
    """
    if not user_id:
        return ""
    return "u#" + hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:10]
