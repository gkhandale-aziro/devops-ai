"""
config/features.py — SEC-7 feature flags / kill switches.

Each flag gates an experimental or cost-heavy code path so an operator
can turn it off without a redeploy when it misbehaves in production.

Precedence (highest to lowest):
    1. Runtime override via `set_enabled()` (admin API, in-process only).
    2. Env var `AZIRO_FEATURE_<NAME_UPPER>` at boot ("0"/"false"/"no" off).
    3. The default declared in `KNOWN_FEATURES`.

Runtime overrides intentionally do NOT persist — a restart returns the
process to env/default. That's the right default for a kill switch:
either the env var is permanently wrong (fix config + redeploy) or
the code path needs to be re-enabled once the incident is over.

Unknown flag names are rejected by `set_enabled()` so a typo can't
silently register a new flag that nothing checks.
"""
from __future__ import annotations

import os
import threading
from typing import Dict


# ── Flag names (constants so callers can't misspell at import time) ─────────

FEATURE_AUTO_MONITOR     = "auto_monitor"
FEATURE_AGENT_TOOLS      = "agent_tools"
FEATURE_ANALYZE_ENDPOINT = "analyze_endpoint"


# ── Registry: name → (default, description) ────────────────────────────────
#
# Description is shown in the admin API response and in logs when the flag
# flips, so operators understand what they're turning off without leaving
# the terminal to grep docs.

KNOWN_FEATURES: Dict[str, tuple[bool, str]] = {
    FEATURE_AUTO_MONITOR: (
        True,
        "Background EventWatcher + triage loop. Off = /api/v1/monitor "
        "returns 503; existing watchers keep running until stopped.",
    ),
    FEATURE_AGENT_TOOLS: (
        True,
        "Agent tool execution (shell/kubectl/etc.). Off = the agent "
        "answers from context only; any tool_call is short-circuited "
        "with a placeholder output.",
    ),
    FEATURE_ANALYZE_ENDPOINT: (
        True,
        "Ad-hoc /api/v1/analyze and /api/v1/analyze/stream. Off = both "
        "return 503; interactive chat endpoints are unaffected.",
    ),
}


_FALSY = {"0", "false", "no", "off", ""}

# Runtime overrides keyed by flag name; None means "fall through to env+default".
_overrides: Dict[str, bool | None] = {name: None for name in KNOWN_FEATURES}
_lock = threading.Lock()


def _env_value(name: str) -> bool | None:
    """Return the env-derived boolean for a flag, or None if unset."""
    raw = os.environ.get(f"AZIRO_FEATURE_{name.upper()}")
    if raw is None:
        return None
    return raw.strip().lower() not in _FALSY


def is_enabled(name: str) -> bool:
    """Return the current effective enabled state for a flag.

    Unknown names return False — a caller asking about a flag that no
    registry entry knows about almost certainly has a typo, and failing
    closed is the safer default for a kill switch.
    """
    if name not in KNOWN_FEATURES:
        return False
    with _lock:
        override = _overrides.get(name)
    if override is not None:
        return override
    env = _env_value(name)
    if env is not None:
        return env
    default, _ = KNOWN_FEATURES[name]
    return default


def set_enabled(name: str, value: bool) -> None:
    """Set a runtime override for a flag. Raises KeyError for unknown names."""
    if name not in KNOWN_FEATURES:
        raise KeyError(f"unknown feature flag: {name}")
    with _lock:
        _overrides[name] = bool(value)


def clear_override(name: str) -> None:
    """Remove a runtime override so the flag falls back to env/default."""
    if name not in KNOWN_FEATURES:
        raise KeyError(f"unknown feature flag: {name}")
    with _lock:
        _overrides[name] = None


def list_flags() -> list[dict]:
    """Snapshot of every known flag for the admin API.

    `source` tells the operator where the current value came from so a
    confusing "I set env=0 but it's still on" becomes visible (answer:
    a runtime override is shadowing the env).
    """
    out = []
    with _lock:
        overrides_snapshot = dict(_overrides)
    for name, (default, description) in KNOWN_FEATURES.items():
        override = overrides_snapshot.get(name)
        env = _env_value(name)
        if override is not None:
            enabled = override
            source = "runtime"
        elif env is not None:
            enabled = env
            source = "env"
        else:
            enabled = default
            source = "default"
        out.append({
            "name": name,
            "enabled": enabled,
            "default": default,
            "source": source,
            "description": description,
        })
    return out
