"""
Tests for agent/conversation.py — _format_stats CLI output.

Regression coverage for M-01: SEV1/SEV2/SEV3 keys were previously L1/L2/L3
AND inverted (SEV3 label showed L1's count). Users saw "0 incidents" forever.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from agent.conversation import _format_stats


class TestFormatStatsSeverityKeys:
    """Counts dict uses SEV1/SEV2/SEV3 keys (matching store/db.py schema)."""

    def test_empty_counts_shows_zero_for_all_levels(self):
        out = _format_stats({"counts": {}, "top_failing": [], "recent": []})
        assert "SEV1 (critical): 0" in out
        assert "SEV2 (warning):  0" in out
        assert "SEV3 (info):     0" in out

    def test_counts_use_SEV_keys_not_legacy_L_keys(self):
        """The fix: counts.get('SEV1') — not counts.get('L3')."""
        out = _format_stats({
            "counts": {"SEV1": 3, "SEV2": 5, "SEV3": 7},
            "top_failing": [], "recent": [],
        })
        assert "SEV1 (critical): 3" in out
        assert "SEV2 (warning):  5" in out
        assert "SEV3 (info):     7" in out

    def test_legacy_L_keys_are_ignored(self):
        """Old L1/L2/L3 keys from stale DBs should NOT be read."""
        out = _format_stats({
            "counts": {"L1": 99, "L2": 99, "L3": 99},
            "top_failing": [], "recent": [],
        })
        # All severity lines show 0 — the legacy keys are not picked up
        assert "SEV1 (critical): 0" in out
        assert "SEV2 (warning):  0" in out
        assert "SEV3 (info):     0" in out
        assert "99" not in out

    def test_critical_mapping_is_correct(self):
        """SEV1 is critical — not the label for SEV3's count."""
        out = _format_stats({
            "counts": {"SEV1": 1, "SEV3": 99},
            "top_failing": [], "recent": [],
        })
        assert "SEV1 (critical): 1" in out
        assert "SEV3 (info):     99" in out
        # Regression guard: the old bug had "SEV1 (critical): 99" because
        # it was reading counts.get('L3') with L3=99 pretending to be critical
        assert "SEV1 (critical): 99" not in out

    def test_top_failing_rendered(self):
        out = _format_stats({
            "counts": {},
            "top_failing": [{
                "object": "nginx-abc", "namespace": "default", "count": 4,
                "last_seen": "2026-04-15T10:00", "worst_level": "SEV2",
            }],
            "recent": [],
        })
        assert "nginx-abc" in out
        assert "4 incidents" in out

    def test_recent_events_rendered(self):
        out = _format_stats({
            "counts": {},
            "top_failing": [],
            "recent": [{
                "level": "SEV1", "timestamp": "2026-04-15T10:00:00",
                "reason": "OOMKilled", "object": "pod-x",
            }],
        })
        assert "[SEV1]" in out
        assert "OOMKilled" in out
        assert "pod-x" in out
