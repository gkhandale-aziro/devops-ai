"""
Tests for EventStore.transition_event / get_event_transitions.

These are the store-layer tests for the 8-state incident lifecycle —
the state machine itself is covered in test_lifecycle.py; here we
verify that a valid transition:

  - updates events.lifecycle_state,
  - writes exactly one incident_transitions row with from_state/to_state,
  - stamps approved_by / approved_at when landing in Approved, and
  - that save_event() records the Detected origin transition.

An invalid edge must raise InvalidTransition with no side effects so
the caller's API 409 can't accidentally leave the DB half-modified.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from store.lifecycle import (
    APPROVED,
    DETECTED,
    DIAGNOSING,
    EXECUTING,
    InvalidTransition,
    PROPOSING,
    RESOLVED,
    TRIAGING,
    VERIFIED,
)


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    sys.modules.pop("store", None)
    sys.modules.pop("store.db", None)
    from store.db import EventStore
    return EventStore(db_file=str(tmp_path / "aziro.db"))


@pytest.fixture
def event_id(store):
    return store.save_event(
        {"object": "paymentsvc", "reason": "CrashLoopBackOff",
         "namespace": "demo", "message": "crashloop"},
        "SEV2",
    )


class TestOriginTransition:
    def test_save_event_writes_detected_row(self, store, event_id):
        """save_event must record an initial Detected transition in the
        same txn — otherwise the UI timeline is missing its origin."""
        rows = store.get_event_transitions(event_id)
        assert len(rows) == 1
        assert rows[0]["from_state"] == ""
        assert rows[0]["to_state"] == DETECTED
        assert rows[0]["actor"] == "system:ingest"

    def test_events_lifecycle_state_defaults_to_detected(self, store, event_id):
        evt = store.get_event(event_id)
        assert evt["lifecycle_state"] == DETECTED


class TestHappyPathTransitions:
    def test_walk_through_all_states(self, store, event_id):
        path = [
            (DETECTED, TRIAGING, "system:triager"),
            (TRIAGING, DIAGNOSING, "system:analyzer"),
            (DIAGNOSING, PROPOSING, "system:analyzer"),
            (PROPOSING, APPROVED, "alice"),
            (APPROVED, EXECUTING, "system:executor"),
            (EXECUTING, VERIFIED, "system:verifier"),
            (VERIFIED, RESOLVED, "system:executor"),
        ]
        for from_state, to_state, actor in path:
            result = store.transition_event(
                event_id, to_state, actor, reason=f"moving to {to_state}"
            )
            assert result["from_state"] == from_state
            assert result["to_state"] == to_state
            evt = store.get_event(event_id)
            assert evt["lifecycle_state"] == to_state

        # Full timeline: origin + 7 transitions = 8 rows.
        rows = store.get_event_transitions(event_id)
        assert len(rows) == 8
        assert [r["to_state"] for r in rows] == [
            DETECTED, TRIAGING, DIAGNOSING, PROPOSING,
            APPROVED, EXECUTING, VERIFIED, RESOLVED,
        ]


class TestApprovalStamping:
    def test_approved_state_records_approver(self, store, event_id):
        store.transition_event(event_id, TRIAGING, "system:triager")
        store.transition_event(event_id, DIAGNOSING, "system:analyzer")
        store.transition_event(event_id, PROPOSING, "system:analyzer")
        store.transition_event(event_id, APPROVED, "alice",
                               reason="LGTM, roll it")

        evt = store.get_event(event_id)
        assert evt["approved_by"] == "alice"
        assert evt["approved_at"]  # non-empty ISO timestamp

    def test_non_approved_transitions_leave_approver_empty(self, store, event_id):
        store.transition_event(event_id, TRIAGING, "system:triager")
        evt = store.get_event(event_id)
        assert evt["approved_by"] == ""
        assert evt["approved_at"] == ""


class TestInvalidTransitions:
    def test_skip_state_rejected(self, store, event_id):
        # Detected → Approved skips three intermediate states.
        with pytest.raises(InvalidTransition):
            store.transition_event(event_id, APPROVED, "alice")
        # The reject must be side-effect free.
        evt = store.get_event(event_id)
        assert evt["lifecycle_state"] == DETECTED
        assert len(store.get_event_transitions(event_id)) == 1

    def test_backwards_rejected(self, store, event_id):
        store.transition_event(event_id, TRIAGING, "system:triager")
        with pytest.raises(InvalidTransition):
            store.transition_event(event_id, DETECTED, "alice")

    def test_missing_event_raises_lookup(self, store):
        with pytest.raises(LookupError):
            store.transition_event(99999, TRIAGING, "alice")


class TestAutoTransition:
    """`auto_transition` wraps transition_event and swallows
    LookupError / InvalidTransition so ingest/analyzer pipelines keep
    flowing when lifecycle drifts from the auto path. Returns a bool
    so callers can tell whether a row was written."""

    def test_valid_edge_returns_true_and_writes_row(self, store, event_id):
        ok = store.auto_transition(event_id, TRIAGING, "system:triager",
                                   reason="auto")
        assert ok is True
        evt = store.get_event(event_id)
        assert evt["lifecycle_state"] == TRIAGING
        rows = store.get_event_transitions(event_id)
        assert rows[-1]["actor"] == "system:triager"

    def test_invalid_edge_returns_false_no_raise(self, store, event_id):
        # Detected → Approved is invalid; auto_transition must not raise.
        ok = store.auto_transition(event_id, APPROVED, "system:analyzer")
        assert ok is False
        rows = store.get_event_transitions(event_id)
        assert len(rows) == 1  # only the origin Detected row

    def test_missing_event_returns_false_no_raise(self, store):
        assert store.auto_transition(99999, TRIAGING, "system:triager") is False


class TestShortCircuitResolve:
    def test_resolve_from_detected(self, store, event_id):
        store.transition_event(event_id, RESOLVED, "alice",
                               reason="false alarm — duplicate of #42")
        evt = store.get_event(event_id)
        assert evt["lifecycle_state"] == RESOLVED

    def test_resolve_is_terminal(self, store, event_id):
        store.transition_event(event_id, RESOLVED, "alice")
        with pytest.raises(InvalidTransition):
            # Can't un-resolve — RESOLVED has no outgoing edges.
            store.transition_event(event_id, TRIAGING, "alice")
