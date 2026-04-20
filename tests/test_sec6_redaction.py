"""
tests/test_sec6_redaction.py — SEC-6 PII/secret scrubbing on persisted records.

Two concerns:

1. `sandbox.redact.redact_text` — module-level function shared by the
   streaming SSE path (StreamRedactor) and the store write path. Unit
   tests here lock in the detector set so a new pattern never lands in
   one path and silently skips the other.

2. `store.db.EventStore.save_snapshot` / `save_analysis` — must scrub
   before INSERT. Defense in depth: even if a caller in monitor/triage
   or agent/conversation forgets to redact upstream, the store is the
   single choke point where credentials can't leak into the DB.

3. Retention window — AZIRO_EVENT_RETENTION_DAYS overrides the 30-day
   default. Setting it to 0 causes the next save_event to purge
   everything older than "now", which cascades to snapshots/analyses
   via the existing FK. Useful for test teardown and for operators who
   want a shorter window for compliance reasons.
"""
import os
import sys
import datetime
import sqlite3

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def store(tmp_path, monkeypatch):
    """Fresh EventStore on a temp DB. AZIRO_SNAPSHOT_REDACT defaults on."""
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    # Scrub any prior env override so test default matches prod default.
    monkeypatch.delenv("AZIRO_SNAPSHOT_REDACT", raising=False)
    monkeypatch.delenv("AZIRO_EVENT_RETENTION_DAYS", raising=False)
    sys.modules.pop("store", None)
    sys.modules.pop("store.db", None)
    from store.db import EventStore
    return EventStore(db_file=str(tmp_path / "aziro.db"))


def _evt(obj="crashloop", reason="CrashLoopBackOff"):
    return {
        "object": obj, "reason": reason, "namespace": "demo",
        "message": f"{reason} on {obj}", "type": "Warning",
    }


def _seed_event(store, level="SEV2"):
    return store.save_event(_evt(), level)


def _fetch_snapshot_content(store, event_id):
    with store._conn() as c:
        row = c.execute(
            "SELECT content FROM snapshots WHERE event_id = ? ORDER BY id DESC LIMIT 1",
            (event_id,),
        ).fetchone()
    return row["content"] if row else None


def _fetch_analysis(store, event_id):
    with store._conn() as c:
        row = c.execute(
            "SELECT diagnosis, remediation FROM analyses WHERE event_id = ? "
            "ORDER BY id DESC LIMIT 1",
            (event_id,),
        ).fetchone()
    return (row["diagnosis"], row["remediation"]) if row else (None, None)


# ── 1. Unit: redact_text patterns ────────────────────────────────────────────

class TestRedactTextUnit:
    """Each pattern should be caught by the shared function. If a future
    change accidentally drops one, these cases break loudly instead of
    silently letting a class of secret through."""

    def test_aws_access_key(self):
        from sandbox.redact import redact_text
        result = redact_text("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE in env")
        assert "AKIAIOSFODNN7EXAMPLE" not in result
        assert "[REDACTED]" in result

    def test_aws_secret_key_labeled(self):
        from sandbox.redact import redact_text
        raw = 'aws_secret_access_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"'
        assert "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" not in redact_text(raw)

    def test_generic_api_key(self):
        from sandbox.redact import redact_text
        raw = "api_key=abcdef1234567890ABCDEF"
        assert "abcdef1234567890ABCDEF" not in redact_text(raw)

    def test_jwt(self):
        from sandbox.redact import redact_text
        jwt = (
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
            ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ"
            ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        )
        assert jwt not in redact_text(f"Authorization header carries {jwt} today")

    def test_bearer_token(self):
        from sandbox.redact import redact_text
        raw = "Authorization: Bearer abcdef1234567890ABCDEF1234567890"
        assert "abcdef1234567890ABCDEF1234567890" not in redact_text(raw)

    def test_github_token(self):
        from sandbox.redact import redact_text
        raw = "token: ghp_abcdefghijklmnop0123456789"
        assert "ghp_abcdefghijklmnop0123456789" not in redact_text(raw)

    def test_slack_token(self):
        from sandbox.redact import redact_text
        raw = "slack webhook xoxb-1234567890-abcdefg"
        assert "xoxb-1234567890-abcdefg" not in redact_text(raw)

    def test_google_api_key(self):
        from sandbox.redact import redact_text
        raw = "GOOGLE_API_KEY=AIzaSyA-abcdefghijklmnopqrstuvwxyz0123456"
        assert "AIzaSyA-abcdefghijklmnopqrstuvwxyz0123456" not in redact_text(raw)

    def test_postgres_connection_string(self):
        from sandbox.redact import redact_text
        raw = "DATABASE_URL=postgres://admin:SuperSecret123@db.internal:5432/app"
        out = redact_text(raw)
        assert "SuperSecret123" not in out

    def test_private_key_block(self):
        from sandbox.redact import redact_text
        raw = "-----BEGIN RSA PRIVATE KEY-----\nMIIE..."
        assert "BEGIN RSA PRIVATE KEY" not in redact_text(raw)

    def test_clean_text_passes_through(self):
        """Legitimate log lines without secrets must survive unchanged —
        over-redaction destroys the debuggability the snapshot exists for."""
        from sandbox.redact import redact_text
        raw = "Pod crashloop restarting. ExitCode=137. OOMKilled."
        assert redact_text(raw) == raw

    def test_empty_and_none_safe(self):
        from sandbox.redact import redact_text
        assert redact_text("") == ""
        assert redact_text(None) is None


class TestStreamRedactorSharesPatterns:
    """StreamRedactor must delegate to the module-level redact_text so
    the SSE path and store path can never diverge."""

    def test_stream_redactor_uses_same_patterns(self):
        from sandbox.redact import StreamRedactor
        r = StreamRedactor()
        out = r._redact_text("api_key=abcdef1234567890ABCDEF")
        assert "abcdef1234567890ABCDEF" not in out
        assert "[REDACTED]" in out


# ── 2. Integration: store.save_snapshot scrubs before INSERT ────────────────

class TestSaveSnapshotRedacts:
    def test_aws_key_in_snapshot_is_scrubbed(self, store):
        eid = _seed_event(store)
        store.save_snapshot(eid, "logs",
                            "Starting app\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nReady")
        content = _fetch_snapshot_content(store, eid)
        assert "AKIAIOSFODNN7EXAMPLE" not in content
        assert "[REDACTED]" in content
        # Non-secret context must survive.
        assert "Starting app" in content
        assert "Ready" in content

    def test_jwt_in_kubectl_describe_output_scrubbed(self, store):
        """describe dumps env vars; JWTs leaking into env is a real pattern."""
        eid = _seed_event(store)
        raw = (
            "Environment:\n"
            "  AUTH_TOKEN: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
            ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ"
            ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c\n"
        )
        store.save_snapshot(eid, "describe", raw)
        content = _fetch_snapshot_content(store, eid)
        assert "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c" not in content

    def test_clean_snapshot_preserved(self, store):
        """A kubectl-logs output with no secrets must land in the DB
        byte-for-byte — the feature's value is scrub, not mangle."""
        eid = _seed_event(store)
        raw = "Pod crashloop restarting. ExitCode=137. OOMKilled."
        store.save_snapshot(eid, "logs", raw)
        assert _fetch_snapshot_content(store, eid) == raw

    def test_empty_content_ok(self, store):
        eid = _seed_event(store)
        store.save_snapshot(eid, "logs", "")
        assert _fetch_snapshot_content(store, eid) == ""

    def test_opt_out_via_env(self, tmp_path, monkeypatch):
        """AZIRO_SNAPSHOT_REDACT=0 is for a pen-test-style flow where
        operators intentionally want to inspect raw output. Store must
        honor the opt-out to avoid false-positive mangling."""
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
        monkeypatch.setenv("AZIRO_SNAPSHOT_REDACT", "0")
        sys.modules.pop("store", None)
        sys.modules.pop("store.db", None)
        from store.db import EventStore
        s = EventStore(db_file=str(tmp_path / "aziro.db"))
        eid = s.save_event(_evt(), "SEV2")
        s.save_snapshot(eid, "logs", "api_key=abcdef1234567890ABCDEF")
        assert "abcdef1234567890ABCDEF" in _fetch_snapshot_content(s, eid)


class TestSaveAnalysisRedacts:
    def test_diagnosis_with_token_scrubbed(self, store):
        """LLM output can echo secrets back from the prompt context."""
        eid = _seed_event(store)
        diag = "Pod failing auth. Token in logs: Bearer abcdef1234567890ABCDEF1234567890"
        store.save_analysis(eid, diagnosis=diag)
        saved, _ = _fetch_analysis(store, eid)
        assert "abcdef1234567890ABCDEF1234567890" not in saved
        assert "[REDACTED]" in saved

    def test_remediation_with_secret_scrubbed(self, store):
        eid = _seed_event(store)
        store.save_analysis(
            eid,
            diagnosis="Missing creds",
            remediation="kubectl set env deploy/app AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
        )
        _, remed = _fetch_analysis(store, eid)
        assert "AKIAIOSFODNN7EXAMPLE" not in remed

    def test_clean_diagnosis_preserved(self, store):
        eid = _seed_event(store)
        diag = "OOMKilled — bump memory limit from 128Mi to 512Mi."
        store.save_analysis(eid, diagnosis=diag)
        saved, _ = _fetch_analysis(store, eid)
        assert saved == diag

    def test_length_caps_still_enforced(self, store):
        """The existing [:8000] / [:2000] truncation must still apply —
        redaction doesn't obviate row-size discipline."""
        eid = _seed_event(store)
        store.save_analysis(eid, diagnosis="x" * 9000, remediation="y" * 3000)
        diag, remed = _fetch_analysis(store, eid)
        assert len(diag) <= 8000
        assert len(remed) <= 2000


# ── 3. Retention: env override ──────────────────────────────────────────────

class TestRetentionEnvOverride:
    def test_default_30_days(self, store):
        """Events younger than 30 days must survive the auto-purge that
        runs on every save_event call."""
        eid1 = _seed_event(store)
        _seed_event(store, level="SEV1")  # triggers _purge_old
        with store._conn() as c:
            rows = c.execute("SELECT id FROM events WHERE id = ?", (eid1,)).fetchall()
        assert len(rows) == 1

    def test_custom_short_window_purges_aged_rows(self, tmp_path, monkeypatch):
        """Simulate an aged event by backdating its timestamp, then set
        AZIRO_EVENT_RETENTION_DAYS=1 and trigger a purge via save_event."""
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
        monkeypatch.setenv("AZIRO_EVENT_RETENTION_DAYS", "1")
        sys.modules.pop("store", None)
        sys.modules.pop("store.db", None)
        from store.db import EventStore
        s = EventStore(db_file=str(tmp_path / "aziro.db"))

        old_eid = s.save_event(_evt(obj="old-pod"), "SEV2")
        # Backdate to 5 days ago — beyond the 1-day window.
        ancient = (
            datetime.datetime.now() - datetime.timedelta(days=5)
        ).isoformat()
        with s._conn() as c:
            c.execute("UPDATE events SET timestamp = ? WHERE id = ?", (ancient, old_eid))

        # This save triggers _purge_old. The aged row should go.
        s.save_event(_evt(obj="fresh-pod"), "SEV2")
        with s._conn() as c:
            survived = c.execute("SELECT id FROM events WHERE id = ?", (old_eid,)).fetchall()
        assert survived == []

    def test_snapshots_cascade_on_purge(self, tmp_path, monkeypatch):
        """Snapshots must be removed via FK cascade when their event is
        purged — no orphan secrets surviving the retention window."""
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
        monkeypatch.setenv("AZIRO_EVENT_RETENTION_DAYS", "1")
        sys.modules.pop("store", None)
        sys.modules.pop("store.db", None)
        from store.db import EventStore
        s = EventStore(db_file=str(tmp_path / "aziro.db"))

        eid = s.save_event(_evt(obj="old-pod"), "SEV2")
        s.save_snapshot(eid, "logs", "some log line")
        ancient = (
            datetime.datetime.now() - datetime.timedelta(days=5)
        ).isoformat()
        with s._conn() as c:
            c.execute("UPDATE events SET timestamp = ? WHERE id = ?", (ancient, eid))

        s.save_event(_evt(obj="fresh-pod"), "SEV2")  # triggers purge
        with s._conn() as c:
            snaps = c.execute(
                "SELECT id FROM snapshots WHERE event_id = ?", (eid,)
            ).fetchall()
        assert snaps == []

    def test_malformed_env_falls_back_to_default(self, tmp_path, monkeypatch):
        """A typo in AZIRO_EVENT_RETENTION_DAYS must not crash the worker
        on save_event. Fallback to 30 days is the safe choice."""
        monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
        monkeypatch.setenv("AZIRO_EVENT_RETENTION_DAYS", "not-a-number")
        sys.modules.pop("store", None)
        sys.modules.pop("store.db", None)
        from store.db import EventStore, _retention_days
        assert _retention_days() == 30
        s = EventStore(db_file=str(tmp_path / "aziro.db"))
        # Should not raise.
        s.save_event(_evt(), "SEV2")
