"""
observability/logging.py — JSON logs + per-request correlation ID.

Why not structlog? structlog brings a full processor pipeline for a single
formatter's worth of value here. stdlib logging + a JSON Formatter covers
the requirement (one line per event, parseable by Loki/Datadog/Splunk)
without adding a runtime dep.

Request-ID flow
---------------
Flask's before_request reads the inbound X-Request-ID header (or mints a
fresh UUID4), stashes it in a ContextVar, and the formatter pulls it into
every log record emitted during that request. after_request echoes the
same ID back in the response header so operators can trace a client-side
error to a server log line.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
import uuid
from contextvars import ContextVar
from typing import Optional

REQUEST_ID_HEADER = "X-Request-ID"

# ContextVar survives across `threading.local`-level context switches that
# `threading.local` would miss, and is the recommended primitive for
# request-scoped state in modern Python (3.7+).
_request_id_var: ContextVar[Optional[str]] = ContextVar("request_id", default=None)


def new_request_id() -> str:
    """Generate a fresh request ID. UUID4 hex — 32 chars, URL-safe."""
    return uuid.uuid4().hex


def current_request_id() -> Optional[str]:
    return _request_id_var.get()


def bind_request_id(rid: str) -> None:
    _request_id_var.set(rid)


def clear_request_id() -> None:
    _request_id_var.set(None)


class _JsonFormatter(logging.Formatter):
    """One JSON object per log line. Keys: ts, level, logger, msg, request_id,
    plus any `extra={}` fields the caller passed to the log call."""

    # Attributes LogRecord always carries — we don't want to re-emit them as
    # "extra" because they'd duplicate the top-level fields.
    _STANDARD_ATTRS = frozenset({
        "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
        "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
        "created", "msecs", "relativeCreated", "thread", "threadName",
        "processName", "process", "message", "asctime", "taskName",
    })

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts":      time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
                       + f".{int(record.msecs):03d}Z",
            "level":   record.levelname,
            "logger":  record.name,
            "msg":     record.getMessage(),
        }
        rid = current_request_id()
        if rid:
            payload["request_id"] = rid

        # Pull caller-supplied `extra={...}` fields through. LogRecord stores
        # them as attributes on the record itself, mixed in with stdlib ones,
        # so we filter by known-standard names.
        for k, v in record.__dict__.items():
            if k in self._STANDARD_ATTRS or k.startswith("_"):
                continue
            try:
                json.dumps(v)  # ensure serializable
                payload[k] = v
            except (TypeError, ValueError):
                payload[k] = repr(v)

        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=False)


_configured = False


def configure_logging(level: Optional[str] = None) -> None:
    """Install the JSON handler on the root logger. Idempotent — safe to call
    at module import and from tests that reload modules.

    Level is read from AZIRO_LOG_LEVEL (default INFO) unless explicitly passed.
    """
    global _configured

    resolved = (level or os.environ.get("AZIRO_LOG_LEVEL", "INFO")).upper()
    root = logging.getLogger()
    root.setLevel(resolved)

    # Replace any existing handlers so re-configuring doesn't stack them.
    for h in list(root.handlers):
        root.removeHandler(h)

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(_JsonFormatter())
    root.addHandler(handler)

    # Flask/werkzeug default access log duplicates our structured request
    # log and isn't JSON — silence it.
    logging.getLogger("werkzeug").setLevel(logging.WARNING)

    _configured = True


def get_logger(name: str) -> logging.Logger:
    """Prefer this over logging.getLogger() so callers don't forget to
    configure_logging() at boot."""
    if not _configured:
        configure_logging()
    return logging.getLogger(name)
