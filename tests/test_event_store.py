"""
Tests for store/db.py — EventStore.

Focus: get_stats() must report *active issues* (distinct object+reason still
open), not raw event volume. A crashloop pod that fires 900 times over 9 days
must count as one SEV2, not 900, so the dashboard card matches Live Alerts.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("AZIRO_DATA_DIR", str(tmp_path))
    sys.modules.pop("store", None)
    sys.modules.pop("store.db", None)
    from store.db import EventStore
    return EventStore(db_file=str(tmp_path / "aziro.db"))


def _evt(obj, reason, ns="demo"):
    return {
        "object": obj, "reason": reason, "namespace": ns,
        "message": f"{reason} on {obj}", "type": "Warning",
    }


class TestGetStatsCount:
    def test_empty_store(self, store):
        s = store.get_stats()
        assert s["counts"] == {}

    def test_single_event_counts_one(self, store):
        store.save_event(_evt("crashloop", "CrashLoopBackOff"), "SEV2")
        assert store.get_stats()["counts"].get("SEV2") == 1

    def test_duplicate_object_reason_counts_once(self, store):
        """A pod crashing 50 times with the same reason is ONE active issue."""
        for _ in range(50):
            store.save_event(_evt("crashloop", "CrashLoopBackOff"), "SEV2")
        assert store.get_stats()["counts"].get("SEV2") == 1

    def test_same_object_different_reasons_count_separately(self, store):
        store.save_event(_evt("crashloop", "CrashLoopBackOff"), "SEV2")
        store.save_event(_evt("crashloop", "OOMKilled"), "SEV2")
        assert store.get_stats()["counts"].get("SEV2") == 2

    def test_different_objects_same_reason_count_separately(self, store):
        store.save_event(_evt("pod-a", "CrashLoopBackOff"), "SEV2")
        store.save_event(_evt("pod-b", "CrashLoopBackOff"), "SEV2")
        assert store.get_stats()["counts"].get("SEV2") == 2

    def test_acknowledged_events_excluded(self, store):
        """Once an operator ack's an issue, it shouldn't keep inflating the
        dashboard count."""
        eid = store.save_event(_evt("crashloop", "CrashLoopBackOff"), "SEV2")
        store.update_event_status(eid, "acknowledged")
        assert store.get_stats()["counts"].get("SEV2", 0) == 0

    def test_resolved_events_excluded(self, store):
        eid = store.save_event(_evt("crashloop", "CrashLoopBackOff"), "SEV2")
        store.update_event_status(eid, "resolved")
        assert store.get_stats()["counts"].get("SEV2", 0) == 0

    def test_mixed_statuses_only_open_counted(self, store):
        e1 = store.save_event(_evt("pod-a", "CrashLoopBackOff"), "SEV2")
        store.save_event(_evt("pod-b", "CrashLoopBackOff"), "SEV2")  # open
        store.update_event_status(e1, "resolved")
        assert store.get_stats()["counts"].get("SEV2") == 1

    def test_levels_grouped_independently(self, store):
        store.save_event(_evt("pod-a", "CrashLoopBackOff"), "SEV2")
        store.save_event(_evt("node-x", "NodeNotReady"), "SEV1")
        store.save_event(_evt("pod-c", "BackOff"), "SEV3")
        counts = store.get_stats()["counts"]
        assert counts == {"SEV1": 1, "SEV2": 1, "SEV3": 1}
