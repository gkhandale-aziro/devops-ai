"""Tests for agent/conversation.py CLI formatters.

Regression guard for M-01: _format_stats used to look up counts['L1'/'L2'/'L3']
but the DB (store/db.py:get_stats) returns keys 'SEV1'/'SEV2'/'SEV3', so the
stats panel always showed 0 for every severity.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agent.conversation import _format_stats


class TestFormatStats:
    def test_reads_sev_keys_from_db_shape(self):
        stats = {
            "counts":      {"SEV1": 3, "SEV2": 7, "SEV3": 12},
            "top_failing": [],
            "recent":      [],
        }
        out = _format_stats(stats)
        assert "SEV1 (critical): 3" in out
        assert "SEV2 (warning):  7" in out
        assert "SEV3 (info):     12" in out

    def test_missing_severity_shows_zero(self):
        stats = {"counts": {"SEV1": 2}, "top_failing": [], "recent": []}
        out = _format_stats(stats)
        assert "SEV1 (critical): 2" in out
        assert "SEV2 (warning):  0" in out
        assert "SEV3 (info):     0" in out

    def test_does_not_read_legacy_l_keys(self):
        # If someone passes the old shape, counts should all show 0 —
        # not silently consumed as if they were valid.
        stats = {
            "counts":      {"L1": 99, "L2": 99, "L3": 99},
            "top_failing": [],
            "recent":      [],
        }
        out = _format_stats(stats)
        assert "SEV1 (critical): 0" in out
        assert "SEV2 (warning):  0" in out
        assert "SEV3 (info):     0" in out

    def test_empty_stats(self):
        out = _format_stats({"counts": {}, "top_failing": [], "recent": []})
        assert "SEV1 (critical): 0" in out
        assert "SEV2 (warning):  0" in out
        assert "SEV3 (info):     0" in out
