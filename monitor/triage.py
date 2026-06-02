"""
monitor/triage.py — classifies events into SEV1 / SEV2 / SEV3 and feeds the agent.

SEV3 — Detect   : Warning events with unknown reason. Logged to terminal only.
SEV2 — Diagnose : Known warnings (CrashLoopBackOff, OOMKilled, ...).
                  Captures snapshots → stores in DB → sends to AI with history.
SEV1 — Resolve  : Critical events (NodeNotReady, DiskPressure, ...).
                  Same as SEV2 + AI proposes remediation command.

Key improvements over polling-then-asking:
  1. Snapshots captured the moment event fires — logs/describe saved immediately
     before the pod restarts and logs are lost.
  2. Past incidents fetched from DB — AI sees "3rd OOMKill in 2 hrs" not just
     the current crash.
  3. TTL deduplication — same issue re-investigated after 30 min, not never.
"""
import threading
import time

_REINVESTIGATE_AFTER = 30 * 60   # 30 minutes

# ── severity tables ───────────────────────────────────────────────────────────

_SEV2_REASONS = {
    "BackOff", "CrashLoopBackOff", "Failed", "FailedMount",
    "Unhealthy", "FailedScheduling", "OOMKilled",
    "ImagePullBackOff", "ErrImagePull", "Error",
    "Evicted", "FailedCreate", "FailedSync", "HighRestartCount",
}

_SEV1_REASONS = {
    "NodeNotReady", "MemoryPressure", "DiskPressure",
    "PIDPressure", "NetworkUnavailable", "OutOfDisk", "KubeletNotReady",
}


def capture_snapshots(executor_fn, store, obj, ns, event_id):
    """Run kubectl {describe,logs,logs --previous,get events} and persist
    each non-empty output as a snapshot row keyed on `event_id`. The web
    monitor reaches for this directly (no Triage instance) so the event
    detail pane has the before-state even when triage is classify-only."""
    if not executor_fn:
        return {}

    ns_flag = f"-n {ns}" if ns and ns != "default" else f"-n {ns}"
    # `object` arrives as either "pod/crashloop" (kubectl-events form) or
    # "crashloop" (pod-poll form). kubectl rejects `describe pod pod/x` so
    # normalise to the bare name and let the command supply the resource.
    pod = obj.split("/", 1)[-1] if "/" in obj else obj
    commands = {
        "describe":      f"kubectl describe pod {pod} {ns_flag} 2>/dev/null",
        "logs":          f"kubectl logs {pod} {ns_flag} --tail=150 2>/dev/null",
        "logs_previous": f"kubectl logs {pod} {ns_flag} --previous --tail=150 2>/dev/null || echo '[no previous container]'",
        "events":        f"kubectl get events {ns_flag} --sort-by=.lastTimestamp --no-headers 2>/dev/null | tail -30",
    }

    results = {}
    for kind, cmd in commands.items():
        try:
            out = executor_fn(cmd)
            if out and out.strip():
                results[kind] = out
                if store and event_id:
                    store.save_snapshot(event_id, kind, out)
        except Exception:
            pass
    return results


class Triage:
    """
    Classifies events, captures snapshots immediately, stores everything,
    then sends context-rich queries to the agent.

    Parameters
    ----------
    in_q        : queue.Queue | None  — agent input (CLI auto-queries)
    out_q       : queue.Queue         — agent output (display alerts)
    executor_fn : callable(cmd)->str  — runs kubectl/shell commands for snapshot capture
    store       : EventStore | None   — SQLite store for persistence
    """

    def __init__(self, in_q, out_q, executor_fn=None, store=None):
        self._in_q    = in_q
        self._out_q   = out_q
        self._exec    = executor_fn
        self._store   = store
        self._seen    = {}            # (object, reason) → last_investigated timestamp
        self._lock    = threading.Lock()

    def handle(self, event):
        """Entry point for EventWatcher. Thread-safe."""
        if event.get("type") == "Normal":
            return                            # drop informational events

        reason = event.get("reason", "")
        obj    = event.get("object", "")
        key    = (obj, reason)
        level  = self._classify(reason)

        if level == "SEV3":
            self._l1(event)
            return

        now = time.time()
        with self._lock:
            if now - self._seen.get(key, 0) < _REINVESTIGATE_AFTER:
                return
            self._seen[key] = now

        threading.Thread(
            target=self._l2 if level == "SEV2" else self._l3,
            args=(event,),
            daemon=True,
        ).start()

    def clear(self):
        with self._lock:
            self._seen.clear()

    # ── classification ────────────────────────────────────────────────────────

    def _classify(self, reason):
        if reason in _SEV1_REASONS: return "SEV1"
        if reason in _SEV2_REASONS: return "SEV2"
        return "SEV3"

    # ── SEV3 (info/detect) ───────────────────────────────────────────────────

    def _l1(self, event):
        self._out_q.put({
            "type":             "monitor_alert",
            "level":            "SEV3",
            "summary":          self._summary(event),
            "event":            event,
            "auto_investigate": False,
        })

    # ── SEV2 (diagnose) ──────────────────────────────────────────────────────

    def _l2(self, event):
        obj = event["object"]
        ns  = event.get("namespace", "default")

        # 1. persist event → get id
        event_id = self._store.save_event(event, "SEV2") if self._store else None

        # 1a. classified + captured — move Detected → Triaging so the
        # UI reflects real progress instead of a row stuck on its origin.
        if self._store and event_id is not None:
            self._store.auto_transition(
                event_id, "Triaging", "system:triager",
                reason=f"classified as SEV2 ({event.get('reason', '')})",
            )

        # 2. capture snapshots NOW (before pod restarts and logs are gone)
        snaps = self._capture_snapshots(obj, ns, event_id)

        # 3. fetch past incidents from DB for this object
        history = self._history_context(obj, exclude_id=event_id)

        # 4. notify terminal
        self._out_q.put({
            "type":             "monitor_alert",
            "level":            "SEV2",
            "summary":          self._summary(event),
            "event":            event,
            "auto_investigate": True,
        })

        # 5. send rich query to agent
        if self._in_q is not None:
            self._in_q.put({
                "type":     "query",
                "is_auto":  True,
                "event_id": event_id,
                "text":     self._build_query("SEV2", event, snaps, history),
            })

    # ── SEV1 (critical/resolve) ──────────────────────────────────────────────

    def _l3(self, event):
        obj = event["object"]
        ns  = event.get("namespace", "default")

        event_id = self._store.save_event(event, "SEV1") if self._store else None
        if self._store and event_id is not None:
            self._store.auto_transition(
                event_id, "Triaging", "system:triager",
                reason=f"classified as SEV1 ({event.get('reason', '')})",
            )
        snaps    = self._capture_snapshots(obj, ns, event_id)
        history  = self._history_context(obj, exclude_id=event_id)

        self._out_q.put({
            "type":             "monitor_alert",
            "level":            "SEV1",
            "summary":          f"CRITICAL — {self._summary(event)}",
            "event":            event,
            "auto_investigate": True,
        })

        if self._in_q is not None:
            self._in_q.put({
                "type":     "query",
                "is_auto":  True,
                "event_id": event_id,
                "text":     self._build_query("SEV1", event, snaps, history),
            })

    # ── snapshot capture ─────────────────────────────────────────────────────

    def _capture_snapshots(self, obj, ns, event_id):
        return capture_snapshots(self._exec, self._store, obj, ns, event_id)

    # ── history context ───────────────────────────────────────────────────────

    def _history_context(self, obj, exclude_id=None):
        """
        Fetch past incidents for this object from DB.
        Returns formatted string injected into the AI prompt.
        """
        if not self._store:
            return ""

        past = self._store.get_object_history(obj, limit=5)
        past = [e for e in past if e["id"] != exclude_id]
        if not past:
            return ""

        lines = [f"\n── Past incidents for {obj} (from DB) ──"]
        for e in past[:4]:
            ts        = e["timestamp"][:16]
            diagnosis = (e.get("last_diagnosis") or "no diagnosis recorded")[:120]
            lines.append(f"  {ts}  [{e['level']}] {e['reason']} — {diagnosis}")
        return "\n".join(lines)

    # ── query builder ─────────────────────────────────────────────────────────

    def _build_query(self, level, event, snaps, history):
        obj = event["object"]
        ns  = event.get("namespace", "default")
        msg = event.get("message", "")

        parts = []

        if level == "SEV2":
            parts.append(
                f"[SEV2 WARNING] {event['reason']} on {obj} (namespace: {ns})\n"
                f"Event message: {msg}"
            )
        else:
            parts.append(
                f"[SEV1 CRITICAL] CRITICAL: {event['reason']} on {obj} (namespace: {ns})\n"
                f"Event message: {msg}"
            )

        # inject captured snapshots
        if snaps.get("describe"):
            parts.append(f"\n── kubectl describe (captured now) ──\n{snaps['describe'][:3000]}")
        if snaps.get("logs"):
            parts.append(f"\n── kubectl logs (captured now) ──\n{snaps['logs'][:2000]}")
        if snaps.get("logs_previous"):
            prev = snaps["logs_previous"]
            if "[no previous container]" not in prev:
                parts.append(f"\n── kubectl logs --previous ──\n{prev[:2000]}")
        if snaps.get("events"):
            parts.append(f"\n── recent events ──\n{snaps['events'][:1000]}")

        # inject history
        if history:
            parts.append(history)

        if level == "SEV2":
            parts.append(
                "\nUsing the snapshots and history above, identify the root cause. "
                "If history shows a recurring pattern, highlight it."
            )
        else:
            parts.append(
                "\nUsing the snapshots and history above:\n"
                "1. Identify the root cause\n"
                "2. Propose a specific remediation command\n"
                "   (User will confirm before it is applied)"
            )

        return "\n".join(parts)

    # ── helper ────────────────────────────────────────────────────────────────

    def _summary(self, event):
        ns = event.get("namespace", "")
        return (
            f"{event['reason']} on {event['object']}"
            + (f" [{ns}]" if ns else "")
            + f" — {event.get('message', '')}"
        )
