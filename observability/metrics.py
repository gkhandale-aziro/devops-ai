"""
observability/metrics.py — Prometheus instrumentation (RUN-3).

Why a dedicated module (not inline decorators scattered across the app)?
- Centralizes label schemas so one place decides cardinality risk.
- Keeps prometheus_client imports out of hot paths that don't care.
- Lets tests freeze the label set and catch silent drift.

Multi-process note
------------------
gunicorn runs N workers; each has its own in-memory registry. Scraping one
worker at random gives you 1/N of the truth. prometheus_client supports a
multiprocess mode: workers write shard files to PROMETHEUS_MULTIPROC_DIR,
the parent aggregates them on /metrics scrape.

We opt in when PROMETHEUS_MULTIPROC_DIR is set (done by docker-run.sh),
and gunicorn.conf.py wires the child_exit hook for proper cleanup.
"""
from __future__ import annotations

import os
import re
import time
from typing import Optional

from prometheus_client import (
    CollectorRegistry,
    Counter,
    Histogram,
    Gauge,
    CONTENT_TYPE_LATEST,
    generate_latest,
    multiprocess,
)


# ── Registry ──────────────────────────────────────────────────────────────────
# Single-process: prometheus_client's default REGISTRY is fine, but we use an
# explicit one so tests can reset state without touching globals.
# Multi-process: each worker writes shard files (mmap-backed values) because
# PROMETHEUS_MULTIPROC_DIR is set; on scrape we build a *fresh* registry with
# MultiProcessCollector attached — doing that here on `_registry` in addition
# to `registry=_registry` on each metric would double every series. See
# https://prometheus.github.io/client_python/multiprocess/
_registry = CollectorRegistry()


def registry() -> CollectorRegistry:
    """Expose the registry for tests and direct callers."""
    return _registry


# ── Metric definitions ────────────────────────────────────────────────────────
# Label cardinality is load-bearing. Every `labels(...)` call below is
# reviewed in PR — new labels must be bounded sets (method, status code,
# model name) never free-form user input (paths with IDs, commands, emails).

HTTP_REQUESTS = Counter(
    "aziro_http_requests_total",
    "HTTP requests to /api/ endpoints, labeled by method, normalized route, and status.",
    ["method", "route", "status"],
    registry=_registry,
)

HTTP_LATENCY = Histogram(
    "aziro_http_request_duration_seconds",
    "HTTP request duration in seconds for /api/ endpoints.",
    ["method", "route"],
    # Web-ish buckets: fast APIs (50ms-500ms) + slow ones (LLM stream, kubectl).
    buckets=(0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0),
    registry=_registry,
)

LLM_CALLS = Counter(
    "aziro_llm_calls_total",
    "LLM chat calls by model and outcome.",
    ["model", "outcome"],  # outcome: ok|quota|timeout|error
    registry=_registry,
)

LLM_TOKENS = Counter(
    "aziro_llm_tokens_total",
    "LLM tokens consumed, by model. Direction is a coarse prompt/completion split.",
    ["model", "direction"],  # direction: prompt|completion|total
    registry=_registry,
)

LLM_LATENCY = Histogram(
    "aziro_llm_call_duration_seconds",
    "LLM call wall-clock duration in seconds.",
    ["model", "stream"],  # stream: "0" (non-stream) / "1" (stream)
    # LLM calls are slower than HTTP; buckets are tuned for 0.5s-2min range.
    buckets=(0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0),
    registry=_registry,
)

LLM_FALLBACK = Counter(
    "aziro_llm_fallback_total",
    "Fallback activations from primary to Ollama, by reason.",
    ["from_model", "to_model", "reason"],  # reason: quota|timeout|error
    registry=_registry,
)

TOOL_CALLS = Counter(
    "aziro_tool_calls_total",
    "Agent tool-call executions by tool name and outcome.",
    ["tool", "outcome"],  # outcome: ok|error|denied
    registry=_registry,
)

TOOL_LATENCY = Histogram(
    "aziro_tool_call_duration_seconds",
    "Agent tool-call execution duration in seconds.",
    ["tool"],
    # Tool calls span fast (cached kubectl) to slow (cross-region AWS).
    buckets=(0.1, 0.5, 1.0, 2.5, 5.0, 15.0, 30.0, 60.0),
    registry=_registry,
)

BUILD_INFO = Gauge(
    "aziro_build_info",
    "Aziro build metadata. Value is always 1; labels carry version + git SHA.",
    ["version", "git_sha"],
    registry=_registry,
)


# ── Route normalization ───────────────────────────────────────────────────────
# Without this, every chat session / target ID becomes its own time series
# and Prometheus memory blows up within a week. We collapse:
#   - numeric segments (/api/v1/targets/42)
#   - long hex/UUID segments (/api/v1/chat/a1b2c3.../stream)
# to `:id`. We cap total length so adversarial URIs can't push series ids.

_ROUTE_ID_RE = re.compile(
    r"/("
    r"\d+"                              # pure numeric ID
    r"|[0-9a-fA-F]{8,}"                 # long hex/UUID (min 8 chars)
    r"|[0-9a-zA-Z_-]{20,}"              # long opaque token
    r")(?=/|$)"
)
_ROUTE_MAX_LEN = 80


def normalize_route(path: str) -> str:
    """Normalize URL path for use as a Prometheus label.

    Replaces ID-like path segments with `:id` so `/api/v1/chat/42/stream`
    and `/api/v1/chat/abc/stream` collapse to the same label value.
    Caps length at 80 chars to resist cardinality attacks from long URIs.
    """
    if not path:
        return "/"
    normalized = _ROUTE_ID_RE.sub("/:id", path)
    if len(normalized) > _ROUTE_MAX_LEN:
        normalized = normalized[:_ROUTE_MAX_LEN]
    return normalized


# ── Instrumentation helpers (callsite-facing API) ─────────────────────────────
# Keep providers/client.py and agent/conversation.py clean by offering one
# call per event. Callers never touch Counter/Histogram primitives directly.

def record_http_request(method: str, path: str, status: int, duration_s: float) -> None:
    route = normalize_route(path)
    HTTP_REQUESTS.labels(method=method, route=route, status=str(status)).inc()
    HTTP_LATENCY.labels(method=method, route=route).observe(duration_s)


def record_llm_call(
    model: str,
    duration_s: float,
    *,
    outcome: str = "ok",
    stream: bool = False,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
) -> None:
    """Record one LLM invocation. `outcome` must be one of ok|quota|timeout|error."""
    LLM_CALLS.labels(model=model, outcome=outcome).inc()
    LLM_LATENCY.labels(model=model, stream="1" if stream else "0").observe(duration_s)
    if prompt_tokens:
        LLM_TOKENS.labels(model=model, direction="prompt").inc(prompt_tokens)
    if completion_tokens:
        LLM_TOKENS.labels(model=model, direction="completion").inc(completion_tokens)
    if total_tokens and not (prompt_tokens or completion_tokens):
        # Some providers (Anthropic) only report a combined count.
        LLM_TOKENS.labels(model=model, direction="total").inc(total_tokens)


def record_fallback(from_model: str, to_model: str, reason: str) -> None:
    """Record a primary→fallback activation. `reason` is a bounded enum."""
    LLM_FALLBACK.labels(
        from_model=from_model,
        to_model=to_model,
        reason=reason,
    ).inc()


def record_tool_call(tool: str, duration_s: float, outcome: str) -> None:
    """Record one agent tool dispatch. `outcome` is one of ok|error|denied."""
    TOOL_CALLS.labels(tool=tool, outcome=outcome).inc()
    TOOL_LATENCY.labels(tool=tool).observe(duration_s)


def set_build_info(version: str, git_sha: str) -> None:
    BUILD_INFO.labels(version=version, git_sha=git_sha).set(1)


# ── /metrics handler ──────────────────────────────────────────────────────────

_METRICS_TOKEN = os.environ.get("AZIRO_METRICS_TOKEN", "").strip()


def metrics_handler(authorization_header: Optional[str]) -> tuple[bytes, int, dict]:
    """Return (body, status, headers) for a /metrics request.

    Auth model: if AZIRO_METRICS_TOKEN is unset, the endpoint is open (suits
    local dev and same-host scrape). If set, a Bearer token is required —
    Prometheus scrape config must carry a matching `authorization` block.
    """
    if _METRICS_TOKEN:
        if not authorization_header or not authorization_header.startswith("Bearer "):
            return b"Unauthorized", 401, {"Content-Type": "text/plain; charset=utf-8"}
        supplied = authorization_header[7:]
        # Constant-time compare to avoid leaking token length via timing.
        import hmac
        if not hmac.compare_digest(supplied, _METRICS_TOKEN):
            return b"Unauthorized", 401, {"Content-Type": "text/plain; charset=utf-8"}

    # In multi-process mode, aggregate from shard files via a scrape-only
    # registry. Reading from `_registry` directly would return only this
    # worker's view AND duplicate series if a MultiProcessCollector was also
    # attached to it.
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        scrape_registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(scrape_registry)
        body = generate_latest(scrape_registry)
    else:
        body = generate_latest(_registry)
    return body, 200, {"Content-Type": CONTENT_TYPE_LATEST}


# ── Timing context manager ────────────────────────────────────────────────────

class Timer:
    """Measure wall-clock duration for a block.

    Usage:
        with Timer() as t:
            do_work()
        record_tool_call("run_command", t.seconds, "ok")
    """
    def __init__(self) -> None:
        self._start = 0.0
        self.seconds = 0.0

    def __enter__(self) -> "Timer":
        self._start = time.monotonic()
        return self

    def __exit__(self, *_: object) -> None:
        self.seconds = time.monotonic() - self._start
