"""
store/lifecycle.py — 8-state incident lifecycle state machine.

Every event ingested into Aziro is also an incident travelling through:

    Detected → Triaging → Diagnosing → Proposing → Approved → Executing
              → Verified → Resolved

Transitions are validated here (not scattered through callers), and every
move is appended to `incident_transitions` so the UI timeline and audit
trail can reconstruct exactly who/what moved an incident forward.

State semantics:

    Detected   — event landed in store; nothing looked at it yet.
    Triaging   — ingest pipeline classified severity/target/object.
    Diagnosing — analyzer ran; LLM / rules produced a diagnosis.
    Proposing  — remediation plan drafted, awaiting human approval.
    Approved   — approver signed off (or auto-approved by policy).
    Executing  — scripted executor is applying the fix.
    Verified   — post-fix health check confirms the symptom cleared.
    Resolved   — incident closed; archive-only.

Terminal-ish states:
    - Resolved is terminal.
    - Any state can short-circuit to Resolved with a manual "resolve"
      action (e.g. operator decides it was a false alarm).
"""
from __future__ import annotations

from typing import Dict, FrozenSet


# Canonical state names. Store-as-string (not enum) so legacy rows without
# the column still round-trip cleanly through the API.
DETECTED = "Detected"
TRIAGING = "Triaging"
DIAGNOSING = "Diagnosing"
PROPOSING = "Proposing"
APPROVED = "Approved"
EXECUTING = "Executing"
VERIFIED = "Verified"
RESOLVED = "Resolved"


STATES: tuple[str, ...] = (
    DETECTED, TRIAGING, DIAGNOSING, PROPOSING,
    APPROVED, EXECUTING, VERIFIED, RESOLVED,
)


# Allowed transitions. Each entry is `from -> {to, …}`. Resolve-from-any
# is expressed by adding RESOLVED to every non-terminal set so the rule
# is visible in one place instead of a special case in the check.
_TRANSITIONS: Dict[str, FrozenSet[str]] = {
    DETECTED:   frozenset({TRIAGING, RESOLVED}),
    TRIAGING:   frozenset({DIAGNOSING, RESOLVED}),
    DIAGNOSING: frozenset({PROPOSING, RESOLVED}),
    PROPOSING:  frozenset({APPROVED, RESOLVED}),
    APPROVED:   frozenset({EXECUTING, RESOLVED}),
    EXECUTING:  frozenset({VERIFIED, RESOLVED}),
    VERIFIED:   frozenset({RESOLVED}),
    RESOLVED:   frozenset(),
}


class InvalidTransition(ValueError):
    """Raised when a caller asks for a from→to pair not in _TRANSITIONS."""


def is_valid_transition(from_state: str, to_state: str) -> bool:
    """True when from_state → to_state is an allowed edge.

    Returns False — not raises — so callers can branch cheaply; the
    raise-on-invalid path is in `require_transition`.
    """
    if from_state not in _TRANSITIONS:
        return False
    return to_state in _TRANSITIONS[from_state]


def require_transition(from_state: str, to_state: str) -> None:
    """Raise InvalidTransition if the edge isn't allowed.

    The API layer uses this to return a structured 409 instead of letting
    the DB write succeed and leaving the incident in a nonsensical state.
    """
    if not is_valid_transition(from_state, to_state):
        raise InvalidTransition(
            f"invalid transition: {from_state!r} → {to_state!r}"
        )


def next_states(from_state: str) -> FrozenSet[str]:
    """All states reachable from `from_state` in one step. Empty set on
    terminal (Resolved) or unknown state — UI renders the Approve/Execute
    buttons off this."""
    return _TRANSITIONS.get(from_state, frozenset())


def is_terminal(state: str) -> bool:
    """Resolved has no outgoing edges — hide action buttons on it."""
    return state == RESOLVED
