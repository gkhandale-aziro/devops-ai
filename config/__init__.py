"""config/ — runtime configuration (feature flags, kill switches)."""
from .features import (
    FEATURE_AUTO_MONITOR,
    FEATURE_AGENT_TOOLS,
    FEATURE_ANALYZE_ENDPOINT,
    is_enabled,
    set_enabled,
    list_flags,
    KNOWN_FEATURES,
)

__all__ = [
    "FEATURE_AUTO_MONITOR",
    "FEATURE_AGENT_TOOLS",
    "FEATURE_ANALYZE_ENDPOINT",
    "is_enabled",
    "set_enabled",
    "list_flags",
    "KNOWN_FEATURES",
]
