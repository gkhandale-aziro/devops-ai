"""Observability: structured logging and request correlation (Phase C)."""
from observability.logging import (
    configure_logging,
    get_logger,
    current_request_id,
    new_request_id,
    bind_request_id,
    clear_request_id,
    REQUEST_ID_HEADER,
)

__all__ = [
    "configure_logging",
    "get_logger",
    "current_request_id",
    "new_request_id",
    "bind_request_id",
    "clear_request_id",
    "REQUEST_ID_HEADER",
]
