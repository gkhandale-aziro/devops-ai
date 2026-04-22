"""
tests/test_ops3_loadtest.py — static checks for the OPS-3 k6 smoke.

Running k6 itself needs a live compose stack and 5+ minutes — documented
in ops/loadtest/README.md and the v1.0 checklist §8. What CI CAN
guarantee is that the k6 script still contains the thresholds that make
it a regression signal, and that the SLOs the script gates on stay in
sync with docs/ops/slo.md.

If a future refactor renames a probe endpoint, drops a threshold, or
lets the script run with unbounded VUs, these tests fail loudly instead
of the smoke silently losing its teeth.

    TestK6SmokeScript   — ops/loadtest/smoke.js contents
    TestLoadTestReadme  — ops/loadtest/README.md covers the runbook surface

A TestSloSync class (cross-ref against docs/ops/slo.md +
docs/ops/v1.0-checklist.md) will be added once DOCS-1 (#38) lands on
develop and OPS-3 rebases — those doc files don't exist on this branch
yet, so cross-ref assertions would error on collection.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parent.parent
_LOADTEST = _REPO / "ops" / "loadtest"


# ── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def smoke_js() -> str:
    return (_LOADTEST / "smoke.js").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def loadtest_readme() -> str:
    return (_LOADTEST / "README.md").read_text(encoding="utf-8")


# ── TestK6SmokeScript ───────────────────────────────────────────────────────

class TestK6SmokeScript:
    def test_probes_all_four_endpoints(self, smoke_js):
        """The v1.0 exit criterion names healthz + readyz + metrics
        explicitly; events is the p95 signal. If any is dropped, the
        smoke stops gating what it claims to gate."""
        assert "/api/v1/healthz"         in smoke_js
        assert "/api/v1/readyz"          in smoke_js
        assert "/metrics"                in smoke_js
        assert "/api/v1/events"          in smoke_js

    def test_has_sse_scenario(self, smoke_js):
        """10 concurrent SSE streams is the OPS-3 spec in TODO.md.
        Dropping this scenario would leave 'usable under load' untested —
        the UI is SSE-driven, not request/response. The VU count is
        pinned because thresholds assume 10; bumping to 20 without
        re-baselining p95 would mask real regressions."""
        assert "/api/v1/monitor/stream" in smoke_js
        assert re.search(r"executor:\s*'constant-vus'", smoke_js)
        # Pin the SSE concurrency value so a future refactor can't quietly
        # drop it to 1 (which would still "pass" without actually testing
        # concurrent connections).
        assert re.search(r"sse:\s*\{[^}]*vus:\s*10\b", smoke_js, re.DOTALL), \
            "SSE scenario must declare vus: 10 (OPS-3 spec)"

    def test_probes_use_ramping_vus(self, smoke_js):
        """ramping-vus avoids the thundering-herd artifact you get from
        constant-vus at t=0, which would make p95 numbers meaningless."""
        assert re.search(r"executor:\s*'ramping-vus'", smoke_js)

    def test_vu_count_is_50(self, smoke_js):
        """Thresholds are calibrated for 50 VUs. A bump to 100 VUs
        without re-baselining p95 would make the smoke falsely pass."""
        assert re.search(r"target:\s*50", smoke_js)

    def test_has_events_p95_threshold(self, smoke_js):
        """LAT-1 (p95 < 400ms on /events) is the latency SLO the smoke
        exists to enforce. Without a k6 threshold, it's a check not a gate."""
        assert re.search(
            r"'http_req_duration\{name:events\}':\s*\[\s*'p\(95\)<400'\s*\]",
            smoke_js,
        )

    def test_has_error_rate_threshold(self, smoke_js):
        """Without an error-rate cap the smoke would pass even if
        half the probes 500'd — p95 alone doesn't catch that."""
        assert re.search(
            r"'http_req_failed\{scenario:probes\}':\s*\[\s*'rate<0\.01'\s*\]",
            smoke_js,
        )

    def test_has_healthz_100pct_threshold(self, smoke_js):
        """AVAIL-1 says liveness is 99.5% over 30d, but ANY 503 on
        liveness during a 5-min smoke is a real bug — AVAIL-1 over 30d
        allows planned restarts, not transient-under-load 503s. The
        threshold uses >= 0.999 because k6 has no equality predicate."""
        assert re.search(
            r"'healthz_200_rate':\s*\[\s*'rate>=0\.999'\s*\]",
            smoke_js,
        )

    def test_has_readyz_99pct_threshold(self, smoke_js):
        """Mirrors AVAIL-2 (slo.md): readyz 99.0%."""
        assert re.search(
            r"'readyz_200_rate':\s*\[\s*'rate>=0\.99'\s*\]",
            smoke_js,
        )

    def test_has_metrics_threshold(self, smoke_js):
        """Prometheus scraping /metrics is how every other SLO is
        measured — if /metrics drops to 503 under load, we lose
        observability exactly when we need it most. Any non-200 on
        /metrics must fail the run."""
        assert re.search(
            r"'metrics_200_rate':\s*\[\s*'rate>=0\.999'\s*\]",
            smoke_js,
        )

    def test_sse_hold_has_threshold(self, smoke_js):
        """Without a Rate-backed threshold, the SSE scenario's only
        signal was a plain check() — which doesn't fail the run. A
        regression that silently cut SSE off at 30s would have slipped.
        The sse_held_rate threshold makes the scenario non-zero-exit."""
        # The Rate must exist…
        assert re.search(
            r"new Rate\('sse_held_rate'\)",
            smoke_js,
        ), "sse_held_rate Rate metric missing"
        # …and be wired to a threshold that fails the run on any early
        # disconnect (rate>=1 means every recorded hold was long enough).
        assert re.search(
            r"'sse_held_rate':\s*\[\s*'rate>=1'\s*\]",
            smoke_js,
        ), "sse_held_rate threshold missing or wrong predicate"
        # …and populated by the SSE scenario using SSE_HOLD_S.
        assert re.search(
            r"sseHeldOk\.add\(",
            smoke_js,
        ), "sse_held_rate Rate must be fed via sseHeldOk.add()"

    def test_events_threshold_gated_on_api_key(self, smoke_js):
        """Without AZIRO_API_KEY every /events request is 401, which
        would fail the run for a config reason, not a regression. The
        events threshold must be conditional on API_KEY presence."""
        # Look for the conditional spread — it's the only way to make a
        # threshold optional in k6 options.
        assert re.search(
            r"\.\.\.\(API_KEY\s*\?\s*\{\s*'events_200_rate'",
            smoke_js,
        )

    def test_bounded_sse_hold(self, smoke_js):
        """An unbounded SSE hold turns a k6 hang into an indefinite
        CI stall. Hold duration must be a bounded number."""
        assert re.search(
            r"SSE_HOLD_S\s*=\s*Number\(__ENV\.SSE_HOLD_SECONDS\s*\|\|\s*\d+\)",
            smoke_js,
        )


# ── TestLoadTestReadme ──────────────────────────────────────────────────────

class TestLoadTestReadme:
    def test_documents_invocation(self, loadtest_readme):
        """Runbook without a copy-pasteable invocation forces the reader
        to guess k6's CLI — which is exactly the 2am failure mode."""
        assert "k6 run ops/loadtest/smoke.js" in loadtest_readme

    def test_documents_env_overrides(self, loadtest_readme):
        """AZIRO_URL, AZIRO_API_KEY, SSE_HOLD_SECONDS all need to be
        discoverable from the runbook, not by reading the script."""
        assert "AZIRO_URL"          in loadtest_readme
        assert "AZIRO_API_KEY"      in loadtest_readme
        assert "SSE_HOLD_SECONDS"   in loadtest_readme

    def test_has_troubleshooting_table(self, loadtest_readme):
        """Each threshold should map to a first-action — otherwise
        'healthz_200_rate breached' is just a scary string."""
        assert "Troubleshooting" in loadtest_readme or "Likely cause" in loadtest_readme
        # Each threshold that can fail should be named in the symptoms column.
        for needle in (
            "healthz_200_rate",
            "readyz_200_rate",
            "http_req_duration{name:events}",
        ):
            assert needle in loadtest_readme, f"runbook missing symptom: {needle}"


