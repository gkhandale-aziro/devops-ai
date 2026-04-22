"""
tests/test_monitor_snapshots.py — §3.9 of the v1.0 checklist.

The History page's "kubectl describe / logs / events" sections render
only when `events.snapshots` is populated. Before this regression,
`ui/web.py`'s monitor path classified + broadcast + saved the event row,
but never called `capture_snapshots` — so every SEV1/SEV2 incident
arrived on the detail pane with no before-state, and the checklist's
§3.9 silently failed.

Guards:

    TestCaptureSnapshots — module function behaviour (executor off, all
                           4 kinds persisted, exec errors swallowed, bad
                           store tolerated).
    TestWebTriageWiring  — ui/web.py actually imports and invokes
                           capture_snapshots on the Warning path. Static
                           cross-reference so a future refactor can't
                           quietly go back to the classify-only handler.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from monitor.triage import capture_snapshots


_REPO   = Path(__file__).resolve().parent.parent
_WEB_PY = _REPO / "ui" / "web.py"


# ── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def store(tmp_path, monkeypatch):
    """Fresh EventStore on a temp SQLite so save_snapshot hits a real DB."""
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("AZIRO_SNAPSHOT_REDACT", raising=False)
    monkeypatch.delenv("AZIRO_EVENT_RETENTION_DAYS", raising=False)
    sys.modules.pop("store", None)
    sys.modules.pop("store.db", None)
    from store.db import EventStore
    return EventStore(db_file=str(tmp_path / "aziro.db"))


def _seed_event(store) -> int:
    return store.save_event(
        {"source": "kubernetes", "type": "Warning", "reason": "BackOff",
         "object": "pod/oom-pod", "namespace": "demo", "message": "x"},
        "SEV2",
    )


def _fake_executor(responses: dict):
    """executor_fn stub that returns pre-set output for each kubectl cmd
    substring. Any unmatched command returns ''."""
    def _run(cmd: str) -> str:
        for needle, out in responses.items():
            if needle in cmd:
                return out
        return ""
    return _run


# ── TestCaptureSnapshots ────────────────────────────────────────────────────

class TestCaptureSnapshots:
    def test_returns_empty_when_executor_unset(self, store):
        """Without an executor there's no way to run kubectl — the callee
        should no-op, not raise. Preserves behaviour from when triage
        ran headless before a target was attached."""
        eid = _seed_event(store)
        assert capture_snapshots(None, store, "pod/oom-pod", "demo", eid) == {}

    def test_persists_all_four_kinds_when_exec_returns_content(self, store):
        """All four kubectl kinds — describe, logs, logs_previous, events
        — must land as snapshot rows. If any kind is dropped silently
        the History panel shows a partial picture of the incident and
        the AI drawer's 'snapshots' section loses fidelity."""
        eid = _seed_event(store)
        exec_fn = _fake_executor({
            "describe":        "Name: oom-pod\nStatus: CrashLoopBackOff",
            "logs --previous": "panic: out of memory",
            "logs":            "boot...",
            "get events":      "5m  Warning  BackOff  pod/oom-pod",
        })

        result = capture_snapshots(exec_fn, store, "pod/oom-pod", "demo", eid)

        assert set(result.keys()) == {"describe", "logs", "logs_previous", "events"}

        # DB state: one row per kind, all pointing at `eid`.
        from sqlalchemy import text
        with store._engine.connect() as conn:
            rows = conn.execute(
                text("SELECT kind FROM snapshots WHERE event_id = :eid"),
                {"eid": eid},
            ).fetchall()
        kinds = sorted(r[0] for r in rows)
        assert kinds == ["describe", "events", "logs", "logs_previous"]

    def test_skips_empty_and_whitespace_output(self, store):
        """An executor that returns '' or '  \\n' for a kind means kubectl
        produced no usable output — don't waste a row on it, don't
        confuse the UI with a '(blank)' collapsible."""
        eid = _seed_event(store)
        exec_fn = _fake_executor({
            "describe":  "real describe content",
            # logs + logs_previous + events omitted → returns ''
        })
        result = capture_snapshots(exec_fn, store, "pod/x", "demo", eid)
        assert set(result.keys()) == {"describe"}

    def test_swallows_executor_exceptions(self, store):
        """A kubectl command that throws (network, auth, whatever) must
        not poison the other kinds — we want whatever snapshots we can
        get. This is why the per-kind try/except is per-iteration."""
        eid = _seed_event(store)
        calls = []

        def flaky(cmd):
            calls.append(cmd)
            if "describe" in cmd:
                raise RuntimeError("kubectl explode")
            return "ok"

        result = capture_snapshots(flaky, store, "pod/x", "demo", eid)
        # describe failed → skipped; the other three succeeded.
        assert "describe" not in result
        assert {"logs", "logs_previous", "events"}.issubset(result.keys())

    def test_strips_resource_prefix_from_object(self, store):
        """Kubectl `get events` emits objects as `pod/crashloop`, but
        `kubectl describe pod pod/crashloop` errors — kubectl refuses the
        redundant resource type. If the prefix isn't stripped, every
        command fails, the silent try/except swallows it, and §3.9 is
        empty even with the handler wired up (exactly the regression
        that slipped past the first fix for this bug)."""
        eid = _seed_event(store)
        seen = []

        def capturing(cmd):
            seen.append(cmd)
            return "ok"

        capture_snapshots(capturing, store, "pod/crashloop", "demo", eid)

        describe_cmds = [c for c in seen if "describe" in c]
        assert describe_cmds, "describe command never issued"
        # Must NOT contain the duplicate resource form kubectl rejects.
        assert "pod pod/" not in describe_cmds[0], (
            f"object prefix not stripped — kubectl would reject: {describe_cmds[0]}"
        )

    def test_no_store_write_without_event_id(self, store):
        """event_id=None happens when the caller wants a dry-capture
        (e.g. debug tooling) — still return the dict, but don't write.
        Prevents orphan rows (FK would reject anyway, but we'd rather
        not round-trip a doomed INSERT)."""
        exec_fn = _fake_executor({"describe": "content"})
        result = capture_snapshots(exec_fn, store, "pod/x", "demo", None)
        assert "describe" in result

        from sqlalchemy import text
        with store._engine.connect() as conn:
            n = conn.execute(text("SELECT count(*) FROM snapshots")).scalar()
        assert n == 0


# ── TestWebTriageWiring ─────────────────────────────────────────────────────

class TestWebTriageWiring:
    """Static assertion: the web monitor handler invokes capture_snapshots
    on the SEV1/SEV2 path. Without this guardrail a refactor could
    re-remove the call (that's exactly the bug this test exists to catch)
    and all CI would see is "tests pass; §3.9 still silently empty."
    """

    @pytest.fixture(scope="class")
    def web_src(self) -> str:
        return _WEB_PY.read_text(encoding="utf-8")

    def test_imports_capture_snapshots(self, web_src):
        assert re.search(
            r"from monitor\s+import[^\n]*\bcapture_snapshots\b",
            web_src,
        ), "ui/web.py must import capture_snapshots from monitor"

    def test_invokes_capture_snapshots_on_sev1_sev2(self, web_src):
        """The handler must reach capture_snapshots for SEV1 or SEV2
        events. We allow either a direct call or a threaded call."""
        # Must mention the function name at least twice: once in the
        # import, once in the handler body.
        assert web_src.count("capture_snapshots") >= 2, (
            "ui/web.py imports capture_snapshots but never calls it"
        )
        # Must condition the call on SEV1 or SEV2 classification.
        assert re.search(
            r"level\s+in\s+\(\s*['\"]SEV1['\"]\s*,\s*['\"]SEV2['\"]\s*\)",
            web_src,
        ), "snapshot capture must gate on SEV1/SEV2 classification"

    def test_event_id_captured_from_save_event(self, web_src):
        """save_event returns the new PK — the handler must assign that
        return value (not discard it). A pre-regression handler did
        `_store.save_event(...)` standalone, dropping the id on the
        floor and making downstream snapshot persistence impossible."""
        # Accept any single-assignment variable name (e.g. eid, event_id).
        assert re.search(
            r"\b\w+\s*=\s*_store\.save_event\(",
            web_src,
        ), "web monitor must capture save_event's return value for snapshot linkage"
