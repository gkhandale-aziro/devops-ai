"""
monitor/verify.py — closes the Detect → Diagnose → Resolve → **Verify** loop.

After an operator clicks Execute on a proposed remediation, we need to
prove the fix actually landed. Polling a reason-specific kubectl query
every few seconds is cheaper and more honest than trusting the command's
exit code — `kubectl apply` returns 0 the moment the API server accepts
the YAML, which is long before the pod is actually Running.

Contract
--------
`verify_resolution(executor_fn, event, *, timeout_s=60, poll_interval_s=5,
                   stability_window_s=15)` returns a `VerificationResult`:

    success          — True once the object stayed healthy for
                       stability_window_s; False on timeout.
    attempts         — list of per-poll outcomes (probe output, healthy bool, ts).
    duration_s       — wallclock until the verifier stopped (success or timeout).
    final_state      — the last probe output, for the UI to render.

A single healthy poll isn't enough: CrashLoopBackOff pods transiently
report `Running` between restarts. Demanding stability over a window kills
that false-positive — roughly the same guard `kubectl rollout status`
applies internally.

Reason → predicate map
----------------------
- CrashLoopBackOff / OOMKilled / Error / Evicted → pod.phase=Running and
  restart count stable (no increment between consecutive polls)
- FailedScheduling / FailedCreate → pod.spec.nodeName non-empty
- ImagePullBackOff / ErrImagePull → all containers ready=true
- NodeNotReady / DiskPressure / MemoryPressure / PIDPressure → node
  Ready condition = True and pressure conditions all False
- Unknown reasons → generic "pod Running" or "node Ready" based on
  the object's kind prefix. Any verifier short-circuits to "unknown"
  when the executor returns no output, because a pod that vanished
  after `kubectl delete` is a successful remediation too.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field, asdict
from typing import Callable, List, Optional


# Exec can take ~1s per call; 5s interval + 15s stability = 3 consecutive
# healthy polls minimum. With a 60s cap we get up to ~12 polls, plenty
# of headroom for a rollout to take effect without dragging the demo.
_DEFAULT_TIMEOUT_S        = 60
_DEFAULT_POLL_INTERVAL_S  = 5
_DEFAULT_STABILITY_S      = 15


# Reason groupings. Shared with `monitor/triage.py`'s SEV tables by
# convention, not import — this module is meant to stay a pure leaf
# so it can be unit-tested without spinning up the triage pipeline.
_POD_HEALTH_REASONS = {
    "BackOff", "CrashLoopBackOff", "OOMKilled", "Error",
    "Evicted", "Failed", "FailedSync", "Unhealthy", "HighRestartCount",
}
_POD_SCHED_REASONS = {"FailedScheduling", "FailedCreate", "FailedMount"}
_POD_IMAGE_REASONS = {"ImagePullBackOff", "ErrImagePull"}
_NODE_REASONS = {
    "NodeNotReady", "MemoryPressure", "DiskPressure",
    "PIDPressure", "NetworkUnavailable", "OutOfDisk", "KubeletNotReady",
}


@dataclass
class Attempt:
    ts:      float
    probe:   str
    output:  str
    healthy: bool


@dataclass
class VerificationResult:
    success:     bool
    reason:      str                   # what we verified against
    predicate:   str                   # human string for the UI
    attempts:    List[Attempt] = field(default_factory=list)
    duration_s:  float = 0.0
    final_state: str = ""
    note:        str = ""              # free-text context, esp. on failure

    def to_dict(self) -> dict:
        d = asdict(self)
        d["attempts"] = [asdict(a) for a in self.attempts]
        return d


# ── helpers ─────────────────────────────────────────────────────────────────

def _split_object(obj: str) -> tuple[str, str]:
    """Turn ``pod/crashloop`` into (``pod``, ``crashloop``). Bare names
    default to pod — matches the same assumption `capture_snapshots`
    makes when the event arrives in pod-poll form."""
    if "/" in obj:
        kind, _, name = obj.partition("/")
        return kind.lower(), name
    return "pod", obj


def _ns_flag(ns: str) -> str:
    return f"-n {ns}" if ns else "-n default"


def _safe_exec(executor_fn: Callable[[str], str], cmd: str) -> str:
    """Executor errors become empty output — a transiently unreachable
    API server shouldn't flip the whole run to 'unknown', it should
    register as 'not yet healthy' and be retried next poll."""
    try:
        out = executor_fn(cmd)
    except Exception:
        return ""
    return (out or "").strip()


# ── per-reason probes ──────────────────────────────────────────────────────

def _probe_pod_running(ns: str, name: str) -> str:
    # Emits e.g. "Running|0" — phase then total restartCount across
    # containers. Stability check needs both bits: phase must be Running
    # AND restart count can't climb between polls.
    return (
        f"kubectl get pod {name} {_ns_flag(ns)} "
        f"-o jsonpath='{{.status.phase}}|{{range .status.containerStatuses[*]}}"
        f"{{.restartCount}}+{{end}}' 2>/dev/null"
    )


def _probe_pod_scheduled(ns: str, name: str) -> str:
    return (
        f"kubectl get pod {name} {_ns_flag(ns)} "
        f"-o jsonpath='{{.spec.nodeName}}' 2>/dev/null"
    )


def _probe_pod_ready(ns: str, name: str) -> str:
    # All containers must be ready=true. jsonpath emits "true true" etc.
    return (
        f"kubectl get pod {name} {_ns_flag(ns)} "
        f"-o jsonpath='{{range .status.containerStatuses[*]}}"
        f"{{.ready}} {{end}}' 2>/dev/null"
    )


def _probe_node_ready(name: str) -> str:
    # Ready=True is step one; step two is that no pressure condition
    # is True. `tr` keeps the single-line jsonpath output parseable.
    return (
        f"kubectl get node {name} "
        f"-o jsonpath='Ready={{.status.conditions[?(@.type==\"Ready\")].status}} "
        f"Mem={{.status.conditions[?(@.type==\"MemoryPressure\")].status}} "
        f"Disk={{.status.conditions[?(@.type==\"DiskPressure\")].status}} "
        f"PID={{.status.conditions[?(@.type==\"PIDPressure\")].status}}' 2>/dev/null"
    )


# ── healthiness predicates ─────────────────────────────────────────────────

def _is_healthy_pod_running(out: str, prev: Optional[str]) -> bool:
    if "|" not in out:
        return False
    phase, _, restarts = out.partition("|")
    if phase != "Running":
        return False
    # No previous poll yet → one healthy reading isn't enough to
    # trust; the stability window handles that, so return True here
    # and let the window accrue.
    if prev is None or "|" not in prev:
        return True
    _, _, prev_restarts = prev.partition("|")
    return restarts == prev_restarts


def _is_healthy_pod_scheduled(out: str, _prev: Optional[str]) -> bool:
    return bool(out.strip())


def _is_healthy_pod_ready(out: str, _prev: Optional[str]) -> bool:
    tokens = out.split()
    return bool(tokens) and all(t == "true" for t in tokens)


def _is_healthy_node(out: str, _prev: Optional[str]) -> bool:
    if "Ready=True" not in out:
        return False
    # Any pressure still True → not healthy. Split on whitespace so we
    # don't regex the jsonpath output itself.
    for tok in out.split():
        if tok in ("Mem=True", "Disk=True", "PID=True"):
            return False
    return True


# ── dispatch ────────────────────────────────────────────────────────────────

def _pick_verifier(event: dict):
    """Return (reason_bucket, predicate_label, probe_fn, healthy_fn)
    matched to this event. Fallback is pod-Running or node-Ready based
    on the `object` kind prefix."""
    reason = event.get("reason", "")
    obj    = event.get("object", "")
    ns     = event.get("namespace", "default") or "default"
    kind, name = _split_object(obj)

    if reason in _POD_HEALTH_REASONS:
        return ("pod-running",
                f"pod {name} reaches Running and restart count holds steady",
                lambda: _probe_pod_running(ns, name), _is_healthy_pod_running)
    if reason in _POD_SCHED_REASONS:
        return ("pod-scheduled",
                f"pod {name} has a node assigned",
                lambda: _probe_pod_scheduled(ns, name), _is_healthy_pod_scheduled)
    if reason in _POD_IMAGE_REASONS:
        return ("pod-ready",
                f"pod {name} container images pull and containers report ready",
                lambda: _probe_pod_ready(ns, name), _is_healthy_pod_ready)
    if reason in _NODE_REASONS:
        return ("node-ready",
                f"node {name} is Ready with no pressure conditions",
                lambda: _probe_node_ready(name), _is_healthy_node)

    # Generic fallback by object kind.
    if kind == "node":
        return ("node-ready",
                f"node {name} is Ready with no pressure conditions",
                lambda: _probe_node_ready(name), _is_healthy_node)
    return ("pod-running",
            f"pod {name} reaches Running and restart count holds steady",
            lambda: _probe_pod_running(ns, name), _is_healthy_pod_running)


# ── public entry point ─────────────────────────────────────────────────────

def verify_resolution(
    executor_fn:         Callable[[str], str],
    event:               dict,
    *,
    timeout_s:           int = _DEFAULT_TIMEOUT_S,
    poll_interval_s:     int = _DEFAULT_POLL_INTERVAL_S,
    stability_window_s:  int = _DEFAULT_STABILITY_S,
    sleep_fn:            Callable[[float], None] = time.sleep,
    clock_fn:            Callable[[], float]     = time.monotonic,
) -> VerificationResult:
    """Poll until the object is healthy for ``stability_window_s`` or we
    run out of time. `sleep_fn` / `clock_fn` are injectable so tests can
    drive the loop without real wall-clock delays."""
    bucket, label, probe_fn, healthy_fn = _pick_verifier(event)

    started = clock_fn()
    attempts: List[Attempt] = []
    healthy_since: Optional[float] = None
    prev_out: Optional[str] = None

    while True:
        elapsed = clock_fn() - started
        if elapsed >= timeout_s:
            return VerificationResult(
                success=False, reason=bucket, predicate=label,
                attempts=attempts, duration_s=elapsed,
                final_state=prev_out or "",
                note=f"timed out after {int(elapsed)}s — predicate never satisfied"
                     f" for {stability_window_s}s continuously",
            )

        probe = probe_fn()
        out = _safe_exec(executor_fn, probe)
        healthy = healthy_fn(out, prev_out)
        attempts.append(Attempt(ts=clock_fn(), probe=probe, output=out, healthy=healthy))

        if healthy:
            if healthy_since is None:
                healthy_since = clock_fn()
            elif clock_fn() - healthy_since >= stability_window_s:
                return VerificationResult(
                    success=True, reason=bucket, predicate=label,
                    attempts=attempts, duration_s=clock_fn() - started,
                    final_state=out,
                    note=f"healthy for {int(clock_fn() - healthy_since)}s continuously",
                )
        else:
            healthy_since = None

        prev_out = out
        sleep_fn(poll_interval_s)


# ── command parsing ────────────────────────────────────────────────────────

def parse_proposed_command(remediation: str) -> Optional[str]:
    """Extract the first ``kubectl …`` line from a free-text remediation
    string. The AI's output is markdown — code-fenced, inline-backticked,
    or plain prose — and we want the exact command to pre-fill the
    confirmation modal. Returning None means the operator will have to
    type it themselves."""
    if not remediation:
        return None
    for raw in remediation.splitlines():
        line = raw.strip().lstrip("`").rstrip("`").strip()
        # Strip leading shell-prompt noise some models love to emit.
        for prefix in ("$ ", "# ", "> "):
            if line.startswith(prefix):
                line = line[len(prefix):]
        if line.startswith("kubectl "):
            return line
    return None
