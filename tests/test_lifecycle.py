"""
Tests for store/lifecycle.py — the 8-state incident machine.

Covers:
  - Every state in the happy path has exactly the next edge we expect
  - The short-circuit-to-Resolved rule applies from every non-terminal
  - Resolved is terminal (no outgoing edges)
  - require_transition raises InvalidTransition on bad edges
  - next_states matches the declared table (used by UI to render actions)
"""
from __future__ import annotations

import pytest

from store.lifecycle import (
    APPROVED,
    DETECTED,
    DIAGNOSING,
    EXECUTING,
    InvalidTransition,
    PROPOSING,
    RESOLVED,
    STATES,
    TRIAGING,
    VERIFIED,
    is_terminal,
    is_valid_transition,
    next_states,
    require_transition,
)


# Canonical happy-path order — asserting this explicitly so a refactor
# that reorders states in STATES without updating _TRANSITIONS would be
# caught here instead of causing a silent UX regression.
HAPPY_PATH = [
    DETECTED, TRIAGING, DIAGNOSING, PROPOSING,
    APPROVED, EXECUTING, VERIFIED, RESOLVED,
]


class TestHappyPath:
    def test_states_tuple_matches_happy_path(self):
        assert list(STATES) == HAPPY_PATH

    @pytest.mark.parametrize("from_state,to_state", list(zip(HAPPY_PATH, HAPPY_PATH[1:])))
    def test_every_forward_edge_is_valid(self, from_state, to_state):
        assert is_valid_transition(from_state, to_state)


class TestShortCircuitResolve:
    """Any non-terminal state can jump straight to Resolved — operator
    mark-as-false-alarm path. Asserting it per-state so adding a new
    state won't silently lose the resolve-from-anywhere rule."""

    @pytest.mark.parametrize(
        "state",
        [DETECTED, TRIAGING, DIAGNOSING, PROPOSING, APPROVED, EXECUTING],
    )
    def test_non_terminal_can_resolve(self, state):
        assert is_valid_transition(state, RESOLVED)

    def test_verified_can_resolve(self):
        # Verified only has one outgoing edge, and it must be Resolved.
        assert next_states(VERIFIED) == frozenset({RESOLVED})


class TestBackwardsAndSkip:
    """Rejected edges: no going back, no skipping states in the pipeline."""

    def test_cannot_skip_diagnosing(self):
        assert not is_valid_transition(TRIAGING, PROPOSING)

    def test_cannot_go_backwards(self):
        assert not is_valid_transition(DIAGNOSING, TRIAGING)

    def test_cannot_self_loop(self):
        for s in STATES:
            assert not is_valid_transition(s, s), s


class TestTerminalState:
    def test_resolved_is_terminal(self):
        assert is_terminal(RESOLVED)
        assert next_states(RESOLVED) == frozenset()

    @pytest.mark.parametrize(
        "state", [DETECTED, TRIAGING, DIAGNOSING, PROPOSING,
                  APPROVED, EXECUTING, VERIFIED])
    def test_non_resolved_states_not_terminal(self, state):
        assert not is_terminal(state)


class TestRequireTransition:
    def test_raises_on_bad_edge(self):
        with pytest.raises(InvalidTransition) as exc:
            require_transition(DETECTED, APPROVED)
        assert "Detected" in str(exc.value)
        assert "Approved" in str(exc.value)

    def test_silent_on_good_edge(self):
        require_transition(DETECTED, TRIAGING)  # no raise

    def test_raises_on_unknown_state(self):
        with pytest.raises(InvalidTransition):
            require_transition("Bogus", DETECTED)
