"""
Tests for observability/shutdown.py — RUN-5 graceful shutdown.

Scope:
  - `is_shutting_down()` toggles only after `request_shutdown()`
  - `@sse_stream` decorator registers / deregisters / closes generators
  - Draining mid-stream yields an `event: shutdown` frame and stops
  - `tracked_popen` registers, `untrack_popen` removes, `request_shutdown`
    terminates any that are still live
  - `/api/v1/readyz` flips to 503 + Retry-After when draining
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from observability import shutdown as sd


@pytest.fixture(autouse=True)
def _reset_state():
    """Every test starts with a clean registry and the flag cleared.

    `_reload_web` below pops `observability.shutdown` from `sys.modules`
    and re-imports it, producing a second module object distinct from
    the `sd` handle at the top of this file. Tests that flip the flag
    via the re-imported module would otherwise leak `_shutting_down=True`
    into later test files (seen failing `tests/test_web_validation.py`
    after this file). Reset both to be safe."""
    sd._reset_for_tests()
    yield
    sd._reset_for_tests()
    live = sys.modules.get("observability.shutdown")
    if live is not None and live is not sd:
        live._reset_for_tests()


# ── flag semantics ───────────────────────────────────────────────────────────

class TestShutdownFlag:
    def test_flag_false_by_default(self):
        assert sd.is_shutting_down() is False

    def test_flag_true_after_request(self):
        sd.request_shutdown(sse_grace_seconds=0, popen_term_grace_seconds=0)
        assert sd.is_shutting_down() is True

    def test_request_shutdown_is_idempotent(self):
        sd.request_shutdown(sse_grace_seconds=0, popen_term_grace_seconds=0)
        # Second call must be a no-op, not raise.
        sd.request_shutdown(sse_grace_seconds=0, popen_term_grace_seconds=0)
        assert sd.is_shutting_down() is True


# ── sse_stream decorator ─────────────────────────────────────────────────────

class TestSseStream:
    def test_registers_and_deregisters_on_normal_exit(self):
        """`wrapper` is itself a generator (uses `yield`), so registration
        happens on first `next()`, not on call. Deregistration runs in the
        wrapper's `finally` once the generator is exhausted."""
        @sd.sse_stream
        def gen():
            yield "a"
            yield "b"

        it = gen()
        # Not yet started → no registration.
        assert len(sd._streams) == 0
        next(it)
        assert len(sd._streams) == 1
        # Drain fully; wrapper's finally runs.
        rest = list(it)
        assert rest == ["b"]
        assert len(sd._streams) == 0

    def test_deregisters_on_generator_exit(self):
        @sd.sse_stream
        def gen():
            yield "a"
            yield "b"

        it = gen()
        next(it)
        assert len(sd._streams) == 1
        it.close()
        assert len(sd._streams) == 0

    def test_drain_yields_shutdown_frame_and_stops(self):
        """When the shutdown flag flips between yields, the wrapper should
        emit one final `event: shutdown` frame and then stop iterating —
        no matter how much the inner generator still wants to produce.

        We flip the flag directly (instead of calling request_shutdown)
        to isolate the wrapper's own drain behavior from request_shutdown's
        force-close, which happens in a separate greenlet in production."""
        @sd.sse_stream
        def gen():
            yield "data: 1\n\n"
            yield "data: 2\n\n"
            yield "data: 3\n\n"
            yield "data: 4\n\n"

        it = gen()
        first = next(it)
        assert first == "data: 1\n\n"
        # Flip the flag directly.
        sd._shutting_down = True
        remaining = list(it)
        # Expect: the in-flight frame (frame 2) + the shutdown notice.
        # NOT frames 3 and 4 — they must be cut off.
        assert any("event: shutdown" in f for f in remaining)
        assert "data: 3\n\n" not in remaining
        assert "data: 4\n\n" not in remaining

    def test_request_shutdown_closes_registered_generator(self):
        """`request_shutdown()` must raise GeneratorExit into every registered
        generator so its `finally` blocks run (DB writes, subprocess cleanup)."""
        finally_ran = {"yes": False}

        @sd.sse_stream
        def gen():
            try:
                while True:
                    yield "tick"
            finally:
                finally_ran["yes"] = True

        it = gen()
        next(it)  # Prime it.
        assert len(sd._streams) == 1
        sd.request_shutdown(sse_grace_seconds=0, popen_term_grace_seconds=0)
        # The inner generator's finally must have run — that's the invariant
        # callers depend on (e.g. to release tracked subprocesses).
        assert finally_ran["yes"] is True


# ── tracked_popen / untrack_popen ────────────────────────────────────────────

class TestTrackedPopen:
    def test_tracked_popen_is_registered(self):
        # Pick a tiny, cross-platform no-op.
        cmd = [sys.executable, "-c", "import time; time.sleep(5)"]
        proc = sd.tracked_popen(cmd)
        try:
            assert proc in sd._processes
        finally:
            proc.kill()
            proc.wait(timeout=3)
            sd.untrack_popen(proc)

    def test_untrack_popen_is_idempotent(self):
        cmd = [sys.executable, "-c", "pass"]
        proc = sd.tracked_popen(cmd)
        proc.wait(timeout=3)
        sd.untrack_popen(proc)
        # Second call must not raise.
        sd.untrack_popen(proc)
        assert proc not in sd._processes

    def test_popen_registered_during_sse_grace_is_also_killed(self):
        """Regression for a timing bug: procs_snapshot used to be taken
        BEFORE the SSE grace sleep, so a Popen spawned from a closing
        wrapper (tracked_popen inside the kubectl-logs generator) would
        miss the kill loop and leak. Fix re-snapshots after the sleep."""
        spawned = {}

        @sd.sse_stream
        def gen():
            try:
                while True:
                    yield "tick"
            finally:
                # Spawn a tracked child during the wrapper's teardown —
                # mirrors the real logs-stream generator's Popen lifecycle.
                spawned["proc"] = sd.tracked_popen(
                    [sys.executable, "-c", "import time; time.sleep(30)"])

        it = gen()
        next(it)  # Prime it so the generator is registered.
        sd.request_shutdown(sse_grace_seconds=0.2, popen_term_grace_seconds=5)
        proc = spawned["proc"]
        t0 = time.monotonic()
        while proc.poll() is None and time.monotonic() - t0 < 3:
            time.sleep(0.05)
        assert proc.poll() is not None, \
            "late-registered Popen was not terminated by request_shutdown"

    def test_request_shutdown_terminates_tracked_popen(self):
        """A long-lived tracked child must be SIGTERMed (or .terminate()'d
        on Windows) by `request_shutdown()`. Give it a wide grace window
        so we aren't racing the Python interpreter's own startup."""
        cmd = [sys.executable, "-c", "import time; time.sleep(30)"]
        proc = sd.tracked_popen(cmd)
        assert proc.poll() is None  # still running

        sd.request_shutdown(sse_grace_seconds=0, popen_term_grace_seconds=5)
        # After request_shutdown returns, the proc should be gone.
        # (wait() is safe to call again — already reaped.)
        t0 = time.monotonic()
        while proc.poll() is None and time.monotonic() - t0 < 3:
            time.sleep(0.05)
        assert proc.poll() is not None


# ── Flask /api/v1/readyz integration ─────────────────────────────────────────

# Modules that capture env or other process-level state at import time.
# If ui.web gains a new dependency with import-time state (e.g. an env-gated
# singleton), add it here so the fresh-import pattern below sees the new
# AZIRO_* values. Mirror any change into tests/test_metrics.py, which uses
# the same pattern.
_RELOAD_MODULES = (
    "ui.web", "store", "store.db", "store.metrics",
    "sessions", "sessions.manager",
    "targets", "targets.manager",
    "auth", "auth.db", "auth.middleware", "auth.routes",
    "observability", "observability.metrics",
    "observability.shutdown", "observability.logging",
)


def _reload_web(tmp_path, monkeypatch):
    """Same pattern as tests/test_metrics.py: ui.web snapshots env at
    import time, so we must clear state and re-import fresh."""
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    for key in ("AZIRO_API_KEY", "AZIRO_AUTH_MODE", "AZIRO_SESSION_SECRET",
                "AZIRO_BOOTSTRAP_ADMIN_USER", "AZIRO_BOOTSTRAP_ADMIN_PASSWORD",
                "AZIRO_METRICS_TOKEN", "AZIRO_RATE_LIMIT"):
        monkeypatch.delenv(key, raising=False)
    for m in _RELOAD_MODULES:
        sys.modules.pop(m, None)
    import ui.web as web_mod
    web_mod.app.config["TESTING"] = True
    return web_mod, web_mod.app.test_client()


@pytest.fixture
def fresh_app(tmp_path, monkeypatch):
    return _reload_web(tmp_path, monkeypatch)


class TestReadyzDraining:
    def test_readyz_ok_when_not_draining(self, fresh_app):
        _, c = fresh_app
        r = c.get("/api/v1/readyz")
        assert r.status_code == 200
        body = r.get_json()
        assert body["status"] == "ok"

    def test_readyz_draining_returns_503_with_retry_after(self, fresh_app):
        """After `request_shutdown()`, /readyz must tell the LB to stop
        routing here, and to try again in ~30s."""
        _web_mod, c = fresh_app
        # The freshly imported ui.web re-imported observability.shutdown
        # from scratch, so our top-level `sd` handle is NOT the same
        # module the app sees. Flip the flag via the app's own module.
        from observability import shutdown as app_sd
        app_sd.request_shutdown(sse_grace_seconds=0, popen_term_grace_seconds=0)
        try:
            r = c.get("/api/v1/readyz")
            assert r.status_code == 503
            assert r.headers.get("Retry-After") == "30"
            body = r.get_json()
            assert body["status"] == "draining"
        finally:
            app_sd._reset_for_tests()


class TestSseEndpointsRejectDuringDrain:
    """Without this guard, a late request could mutate state (_session.set)
    or spawn a subprocess (tracked_popen) on a worker that's already told
    the LB it's gone. Every SSE entry point must bail out before side effects.

    Note: the four chat/analyze routes are decorated with `@limiter.limit(...)`,
    and flask-limiter's `headers_enabled=True` rewrites Retry-After with its
    own calculation. We therefore verify only the status + body contract here;
    the readyz test above pins the exact 30 since /readyz has no rate limit."""

    def _flip_flag(self):
        from observability import shutdown as app_sd
        app_sd._shutting_down = True

    def _assert_draining(self, r):
        assert r.status_code == 503
        body = r.get_json()
        assert body == {"status": "draining"}

    def test_chat_stream_rejects_when_draining(self, fresh_app):
        self._flip_flag()
        _, c = fresh_app
        r = c.post("/api/v1/chat/missing-tid/stream", json={"message": "hi"})
        self._assert_draining(r)

    def test_analyze_stream_rejects_when_draining(self, fresh_app):
        self._flip_flag()
        _, c = fresh_app
        r = c.post("/api/v1/analyze/stream", json={"prompt": "hi"})
        self._assert_draining(r)

    def test_monitor_stream_rejects_when_draining(self, fresh_app):
        self._flip_flag()
        _, c = fresh_app
        r = c.get("/api/v1/monitor/stream")
        self._assert_draining(r)

    def test_sessions_chat_stream_rejects_when_draining(self, fresh_app):
        self._flip_flag()
        _, c = fresh_app
        r = c.post("/api/v1/sessions/missing-sid/chat/stream",
                   json={"message": "hi"})
        self._assert_draining(r)

    def test_logs_stream_rejects_when_draining(self, fresh_app):
        self._flip_flag()
        _, c = fresh_app
        r = c.get("/api/v1/logs/missing-tid/stream?pod=abc")
        self._assert_draining(r)


class TestShutdownOrdering:
    def test_drain_frame_emitted_before_force_close(self):
        """The whole point of sse_grace_seconds is to let actively-consumed
        wrappers emit `event: shutdown` before we slam them shut. Regression
        guard for the order: flag → sleep → close (NOT close → sleep)."""
        captured = []
        started = threading.Event()

        @sd.sse_stream
        def gen():
            while True:
                started.set()
                yield "data: tick\n\n"

        def consumer(it):
            for frame in it:
                captured.append(frame)

        it = gen()
        t = threading.Thread(target=consumer, args=(it,))
        t.start()
        # Explicit checks turn silent timeouts into clear failures: otherwise
        # a stalled consumer would just report "no drain frame" without hint.
        assert started.wait(timeout=1), "consumer never entered the generator"
        # request_shutdown should flip the flag, wait a tick, THEN close.
        sd.request_shutdown(sse_grace_seconds=0.5, popen_term_grace_seconds=0)
        t.join(timeout=3)
        assert not t.is_alive(), "consumer thread did not finish after drain"
        assert any("event: shutdown" in f for f in captured), \
            f"expected drain frame in {captured[-5:]}"
