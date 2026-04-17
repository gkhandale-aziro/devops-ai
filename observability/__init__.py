"""Observability: structured logging (Phase C) + Prometheus metrics (RUN-3)."""
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
]
