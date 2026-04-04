"""
monitor/watcher.py — continuous event watcher for Kubernetes and Docker.

All commands run through executor_fn so they work for both local targets
and remote SSH/kubernetes targets — no subprocess.Popen used here.

Poll strategy (instead of --watch streaming):
  - kubectl events : polled every 30s with deduplication on first run
  - pod status     : polled every 30s, checks STATUS column
  - node status    : polled every 30s, checks STATUS column

Event dict format:
    {
        source:    "kubernetes",
        namespace: str,
        type:      "Normal" | "Warning",
        reason:    str,   e.g. CrashLoopBackOff, OOMKilled
        object:    str,   pod/node name
        message:   str,
    }
"""
import threading
import time

_POLL_INTERVAL = 30   # seconds between each check

_BAD_POD_STATUSES = {
    "CrashLoopBackOff", "OOMKilled", "Error",
    "ImagePullBackOff", "ErrImagePull",
    "Evicted", "Unknown",
}

_HIGH_RESTART_THRESHOLD = 5


class EventWatcher:
    """
    Watches live events and resource status via polling.
    Uses executor_fn for all commands — works for local and remote targets.

    Usage
    -----
        watcher = EventWatcher(executor_fn)
        watcher.on_event(triage.handle)
        watcher.watch()      # starts background threads, returns immediately
        watcher.stop()
    """

    # How long (seconds) before the same pod/node issue is re-emitted
    _DEDUP_TTL = 300  # 5 minutes

    def __init__(self, executor_fn):
        """
        executor_fn : callable(command: str) -> str
            Runs a shell command on the target and returns output as a string.
            CLI: sandbox.execute
            Web: lambda cmd: tools.execute(target, cmd)
        """
        self._exec      = executor_fn
        self._callbacks = []
        self._stop      = threading.Event()
        # dedup caches: key → last_emitted_timestamp
        self._pod_seen  = {}   # (namespace, name, reason) → time.time()
        self._node_seen = {}   # (name, reason) → time.time()

    def on_event(self, callback):
        """Register a callback invoked for every new event dict."""
        self._callbacks.append(callback)

    def watch(self):
        """Start all watchers in background daemon threads. Returns immediately."""
        threading.Thread(target=self._poll_k8s_events, daemon=True).start()
        threading.Thread(target=self._poll_pod_status,  daemon=True).start()
        threading.Thread(target=self._poll_node_status, daemon=True).start()

    def stop(self):
        self._stop.set()

    # ── internal emitter ─────────────────────────────────────────────────────

    def _emit(self, event):
        for cb in self._callbacks:
            try:
                cb(event)
            except Exception:
                pass

    # ── kubernetes events poll ────────────────────────────────────────────────

    def _poll_k8s_events(self):
        """
        Poll kubectl events every _POLL_INTERVAL seconds.
        First poll seeds the known-events set (no emissions).
        Subsequent polls emit only lines that weren't there before.
        This avoids flooding on startup with every historical event.
        """
        seen       = set()
        first_poll = True

        while not self._stop.is_set():
            try:
                output = self._exec(
                    "kubectl get events -A --sort-by=.lastTimestamp "
                    "--no-headers 2>/dev/null | tail -100"
                )
                current = set()
                for line in output.strip().split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    key = hash(line)
                    current.add(key)
                    if not first_poll and key not in seen:
                        self._parse_k8s_event_line(line)

                seen       = current
                first_poll = False

            except Exception:
                pass

            self._sleep(_POLL_INTERVAL)

    def _parse_k8s_event_line(self, line):
        """
        Parse a --no-headers kubectl events line.
        Default column order: NAMESPACE  LAST SEEN  TYPE  REASON  OBJECT  MESSAGE
        """
        parts = line.split(None, 5)
        if len(parts) < 4:
            return

        namespace = parts[0]
        # parts[1] = age (e.g. "2m")
        etype  = parts[2] if len(parts) > 2 else ""   # Normal / Warning
        reason = parts[3] if len(parts) > 3 else ""
        obj    = parts[4] if len(parts) > 4 else ""
        msg    = parts[5].strip() if len(parts) > 5 else ""

        self._emit({
            "source":    "kubernetes",
            "namespace": namespace,
            "type":      etype,
            "reason":    reason,
            "object":    obj,
            "message":   msg,
        })

    # ── pod status poll ───────────────────────────────────────────────────────

    def _poll_pod_status(self):
        """
        Poll pod status every _POLL_INTERVAL seconds using simple default output.
        Default columns: NAMESPACE  NAME  READY  STATUS  RESTARTS  AGE
        """
        while not self._stop.is_set():
            try:
                output = self._exec(
                    "kubectl get pods -A --no-headers 2>/dev/null"
                )
                for line in output.strip().split("\n"):
                    parts = line.split()
                    if len(parts) < 5:
                        continue
                    namespace = parts[0]
                    name      = parts[1]
                    # parts[2] = READY  e.g. "1/2"
                    status    = parts[3]
                    restarts  = int(parts[4]) if parts[4].isdigit() else 0

                    reason = None
                    if status in _BAD_POD_STATUSES:
                        reason = status
                    elif restarts >= _HIGH_RESTART_THRESHOLD:
                        reason = "HighRestartCount"

                    if reason:
                        dedup_key = (namespace, name, reason)
                        now = time.time()
                        last = self._pod_seen.get(dedup_key, 0)
                        if now - last >= self._DEDUP_TTL:
                            self._pod_seen[dedup_key] = now
                            msg = (f"Pod {name} in {namespace} — status: {status}, restarts: {restarts}"
                                   if reason != "HighRestartCount"
                                   else f"Pod {name} in {namespace} has restarted {restarts} times")
                            self._emit({
                                "source":    "kubernetes",
                                "namespace": namespace,
                                "type":      "Warning",
                                "reason":    reason,
                                "object":    name,
                                "message":   msg,
                            })

            except Exception:
                pass

            self._sleep(_POLL_INTERVAL)

    # ── node status poll ──────────────────────────────────────────────────────

    def _poll_node_status(self):
        """
        Poll node status every _POLL_INTERVAL seconds.
        Default columns: NAME  STATUS  ROLES  AGE  VERSION
        STATUS is "Ready" when healthy — anything else is a problem.
        """
        while not self._stop.is_set():
            try:
                output = self._exec(
                    "kubectl get nodes --no-headers 2>/dev/null"
                )
                for line in output.strip().split("\n"):
                    parts = line.split()
                    if len(parts) < 2:
                        continue
                    name   = parts[0]
                    status = parts[1]    # Ready / NotReady / SchedulingDisabled

                    if status != "Ready":
                        dedup_key = (name, "NodeNotReady")
                        now = time.time()
                        if now - self._node_seen.get(dedup_key, 0) >= self._DEDUP_TTL:
                            self._node_seen[dedup_key] = now
                            self._emit({
                                "source":    "kubernetes",
                                "namespace": "",
                                "type":      "Warning",
                                "reason":    "NodeNotReady",
                                "object":    name,
                                "message":   f"Node {name} status is {status}",
                            })

            except Exception:
                pass

            self._sleep(_POLL_INTERVAL)

    # ── helper ────────────────────────────────────────────────────────────────

    def _sleep(self, seconds):
        """Sleep in 1-second ticks so stop() responds quickly."""
        for _ in range(seconds):
            if self._stop.is_set():
                return
            time.sleep(1)
