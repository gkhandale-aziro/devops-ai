"""
observability/shutdown.py — graceful SIGTERM handling (RUN-5).

Why this module exists
----------------------
gunicorn's `graceful_timeout` tells the master "wait N seconds after SIGTERM
before SIGKILL." It does NOT:
  - drain in-flight SSE generators (they keep yielding until the socket dies)
  - kill child subprocesses the app spawned (e.g. `kubectl logs -f`)
  - flip readiness so upstream LBs stop routing to the doomed worker

Without those, a container restart can leak orphan `kubectl` processes into
the host namespace and drop mid-stream chat responses onto the floor.

What we do
----------
1. Track every live SSE generator and every long-lived Popen in module-level
   weak-ish registries.
2. Expose `request_shutdown()` — the single entry point called from a signal
   handler (gunicorn `worker_int` hook). It:
     a. flips `is_shutting_down()` True so `/readyz` returns 503
     b. closes every registered generator (raises GeneratorExit into it)
     c. SIGTERMs every registered subprocess, then SIGKILLs stragglers
3. Provide two thin helpers callers use:
     - `@sse_stream` — decorator that registers a generator for the duration
       of its iteration and emits a final `event: shutdown` frame if the
       worker is told to drain mid-stream
     - `tracked_popen(...)` — wraps `subprocess.Popen`, sets a new process
       group on POSIX, registers for cleanup

The registries are intentionally process-local. gunicorn's master signals
each worker; each worker drains its own streams/subprocesses. No IPC needed.
"""
from __future__ import annotations

import os
import signal
import subprocess
import threading
import time
from typing import Generator, Iterator, Optional, Set


# ── Module state ──────────────────────────────────────────────────────────────
# A plain set is fine: registration/deregistration happens on the greenlet
# running the generator or the one spawning Popen — no cross-process sharing.
# Lock guards against concurrent add/remove from parallel greenlets.
_lock = threading.Lock()
_streams: Set["Iterator"] = set()
_processes: Set[subprocess.Popen] = set()
_shutting_down = False


def is_shutting_down() -> bool:
    """True once `request_shutdown()` has been called.

    Callers use this to flip `/readyz` to 503 and to short-circuit new work.
    """
    return _shutting_down


# ── Generator registration ────────────────────────────────────────────────────

def _register_stream(gen: "Iterator") -> None:
    with _lock:
        _streams.add(gen)


def _unregister_stream(gen: "Iterator") -> None:
    with _lock:
        _streams.discard(gen)


def sse_stream(gen_fn):
    """Decorator: wrap an SSE generator so it can be drained on shutdown.

    Usage:
        def api_chat_stream(...):
            @sse_stream
            def generate():
                yield "..."
            return Response(generate(), mimetype="text/event-stream")

    Behavior:
      - Registers the generator for the lifetime of its iteration.
      - If `is_shutting_down()` flips mid-stream, we yield one last
        `event: shutdown\\ndata: ...\\n\\n` frame so clients can reconnect
        cleanly instead of seeing a TCP reset.
      - Deregisters in `finally` so abandoned generators don't leak.
    """
    def wrapper(*args, **kwargs):
        inner = gen_fn(*args, **kwargs)
        _register_stream(inner)
        try:
            for frame in inner:
                if _shutting_down:
                    # One last polite notice, then we're out. Client reconnects
                    # to the fresh worker; mid-stream state is the caller's
                    # problem to rebuild (sessions persist on their own).
                    try:
                        yield frame
                    except (GeneratorExit, StopIteration):
                        break
                    yield "event: shutdown\ndata: {\"reason\": \"worker draining\"}\n\n"
                    break
                yield frame
        except GeneratorExit:
            # Client disconnected — propagate so the inner generator's own
            # `finally` blocks (e.g. kubectl Popen cleanup) run.
            try:
                inner.close()
            except Exception:
                pass
            raise
        finally:
            _unregister_stream(inner)
    wrapper.__name__ = getattr(gen_fn, "__name__", "sse_stream_wrapped")
    wrapper.__doc__ = gen_fn.__doc__
    return wrapper


# ── Subprocess registration ───────────────────────────────────────────────────

def tracked_popen(*args, **kwargs) -> subprocess.Popen:
    """`subprocess.Popen` that is killed on worker shutdown.

    On POSIX we also set the child into a new process group (`start_new_session`)
    so that `os.killpg()` reaches grandchildren spawned through shells or
    wrappers. Without this, a `kubectl logs -f` terminated cleanly still leaves
    the underlying `kube-apiserver` watcher to exit on its own — fine — but a
    `bash -c "kubectl ..."` would orphan its subshell's children.

    Windows has no process groups in this sense, so we fall back to a plain
    Popen; killing the parent is the best we can offer.
    """
    if os.name == "posix":
        kwargs.setdefault("start_new_session", True)
    proc = subprocess.Popen(*args, **kwargs)
    with _lock:
        _processes.add(proc)
    return proc


def untrack_popen(proc: subprocess.Popen) -> None:
    """Call after the process has been reaped by the caller's own `finally`.

    Safe to call multiple times (uses set.discard).
    """
    with _lock:
        _processes.discard(proc)


# ── Drain ─────────────────────────────────────────────────────────────────────

def request_shutdown(
    *,
    sse_grace_seconds: float = 5.0,
    popen_term_grace_seconds: float = 3.0,
) -> None:
    """Begin graceful shutdown. Safe to call more than once.

    Order matters:
      1. Flip the flag so `/readyz` returns 503 and LBs stop routing.
      2. Close SSE generators — they each get GeneratorExit, run their
         own finally, deregister themselves. We give a short grace window
         for their cleanup to finish before moving on.
      3. SIGTERM every tracked Popen. Give it `popen_term_grace_seconds`,
         then SIGKILL whatever's left.

    Total worst-case wall time: sse_grace_seconds + popen_term_grace_seconds.
    Tune via gunicorn's graceful_timeout (default 30s — plenty of headroom).
    """
    global _shutting_down
    if _shutting_down:
        return
    _shutting_down = True

    # Snapshot under lock; release before iterating so generator's own
    # deregister path doesn't deadlock waiting for us.
    with _lock:
        streams_snapshot = list(_streams)
        procs_snapshot = list(_processes)

    # ── SSE: close each generator ────────────────────────────────────────────
    for gen in streams_snapshot:
        try:
            gen.close()
        except Exception:
            # Never let one misbehaving generator block the rest of the drain.
            pass

    # Give greenlets a beat to run their finally blocks (DB writes,
    # kubectl-log Popen cleanup hanging off a generator, etc.)
    if streams_snapshot:
        time.sleep(sse_grace_seconds)

    # ── Subprocesses: SIGTERM, then SIGKILL stragglers ───────────────────────
    for proc in procs_snapshot:
        if proc.poll() is not None:
            continue  # already exited
        try:
            if os.name == "posix":
                # Kill the whole process group so shell wrappers' children die too.
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            else:
                proc.terminate()
        except (ProcessLookupError, PermissionError, OSError):
            pass

    deadline = time.monotonic() + popen_term_grace_seconds
    for proc in procs_snapshot:
        remaining = max(0.0, deadline - time.monotonic())
        try:
            proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            try:
                if os.name == "posix":
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                else:
                    proc.kill()
            except (ProcessLookupError, PermissionError, OSError):
                pass
        except Exception:
            pass

    with _lock:
        _processes.clear()


def _reset_for_tests() -> None:
    """Test-only: undo the one-way flag. Never call from production code."""
    global _shutting_down
    with _lock:
        _shutting_down = False
        _streams.clear()
        _processes.clear()
