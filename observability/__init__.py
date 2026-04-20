"""Observability: structured logging (C) + Prometheus metrics (RUN-3) + graceful shutdown (RUN-5)."""
from observability.logging import (
    configure_logging,
    get_logger,
    current_request_id,
    new_request_id,
    bind_request_id,
    clear_request_id,
    REQUEST_ID_HEADER,
)
from observability.metrics import (
    Timer,
    metrics_handler,
    normalize_route,
    record_fallback,
    record_http_request,
    record_llm_call,
    record_tool_call,
    set_build_info,
)
from observability.shutdown import (
    is_shutting_down,
    request_shutdown,
    sse_stream,
    tracked_popen,
    untrack_popen,
)

__all__ = [
    "configure_logging",
    "get_logger",
    "current_request_id",
    "new_request_id",
    "bind_request_id",
    "clear_request_id",
    "REQUEST_ID_HEADER",
    "Timer",
    "metrics_handler",
    "normalize_route",
    "record_fallback",
    "record_http_request",
    "record_llm_call",
    "record_tool_call",
    "set_build_info",
    "is_shutting_down",
    "request_shutdown",
    "sse_stream",
    "tracked_popen",
    "untrack_popen",
]
