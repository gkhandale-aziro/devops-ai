"""
observability/redis_client.py — DB-2 Redis singleton.

Three call sites in ui/web.py lean on Redis:
  - flask-limiter storage (shared rate-limit counters across workers)
  - flask-session backend (server-side sessions, survive worker restart)
  - monitor SSE pub/sub (alert fan-out across gunicorn workers)

Every call site MUST tolerate `get_redis()` returning `None` — that's the
dev path when `AZIRO_REDIS_URL` is unset, so pytest and local `./start.sh`
keep working without spinning up a Redis container. Production sets the
env and expects the singleton to connect.

The client is cached per URL — `reset_for_tests()` wipes it so fixtures
can monkeypatch the env and rebuild cleanly between cases.
"""
from __future__ import annotations

import os
import threading
from typing import Optional

from observability.logging import get_logger

log = get_logger("aziro.redis")

_ENV_URL = "AZIRO_REDIS_URL"

_lock = threading.Lock()
_client = None
_cached_url: Optional[str] = None


def get_redis_url() -> Optional[str]:
    """Return the configured Redis URL or None. Empty/whitespace → None so
    `AZIRO_REDIS_URL=""` behaves the same as unset."""
    raw = os.environ.get(_ENV_URL, "") or ""
    raw = raw.strip()
    return raw or None


def get_redis():
    """Return a lazily-constructed `redis.Redis` or None.

    None when:
      - AZIRO_REDIS_URL is unset/empty, or
      - the `redis` library is not installed (fallback to memory/filesystem).

    The client itself is lazy — no TCP call on construction. Callers needing
    liveness use `ping()`.
    """
    global _client, _cached_url
    url = get_redis_url()
    if not url:
        return None

    with _lock:
        if _client is not None and _cached_url == url:
            return _client
        try:
            import redis  # type: ignore
        except ImportError:
            log.warning("redis.library_missing",
                        extra={"hint": "pip install redis>=5.0"})
            return None
        try:
            _client = redis.Redis.from_url(
                url,
                decode_responses=False,
                socket_connect_timeout=2,
                socket_timeout=5,
                health_check_interval=30,
            )
            _cached_url = url
            return _client
        except Exception as e:
            # from_url accepts a malformed URL and fails lazily; build a
            # handful of bad-scheme cases will land here. Log once and
            # let callers degrade.
            log.error("redis.client_init_failed",
                      extra={"error": str(e)[:160]})
            _client = None
            _cached_url = None
            return None


def ping() -> bool:
    """Best-effort reachability probe. Returns True iff PONG received.

    Swallows every exception — this powers /readyz and must not 500 when
    Redis is down. /readyz inspects the bool and surfaces a `"fail: ..."`
    check value instead.
    """
    r = get_redis()
    if r is None:
        return False
    try:
        return bool(r.ping())
    except Exception as e:
        log.warning("redis.ping_failed", extra={"error": str(e)[:120]})
        return False


def is_configured() -> bool:
    """True iff the operator has opted in to Redis — URL is set, regardless
    of whether the endpoint is currently reachable. Used to decide whether
    /readyz should even include a `redis` check."""
    return get_redis_url() is not None


def reset_for_tests() -> None:
    """Discard the cached client. Tests flip AZIRO_REDIS_URL between cases
    and need the next `get_redis()` call to rebuild."""
    global _client, _cached_url
    with _lock:
        _client = None
        _cached_url = None
