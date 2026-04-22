"""
tests/test_rel1_chaos.py — static checks for the REL-1 chaos drill scripts.

Running the drills themselves needs a live compose stack (Postgres + MinIO +
backup sidecar + the Flask app) and is documented in docs/ops/chaos-drills.md.
What we CAN guarantee in CI is that the shell scripts contain the pieces
that make the drills correct — that way a refactor of the health-probe
contract or a renamed container doesn't silently invalidate the drill.

The tests are split into:

    TestKillPostgresScript    — ops/chaos/kill-postgres.sh contents
    TestRunBackupDrillScript  — ops/chaos/run-backup-drill.sh contents
    TestChaosRunbook          — docs/ops/chaos-drills.md documents both drills
    TestCrossRef              — backup-restore.md points at chaos-drills.md
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parent.parent
_CHAOS = _REPO / "ops" / "chaos"


# ── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def kill_sh() -> str:
    return (_CHAOS / "kill-postgres.sh").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def drill_sh() -> str:
    return (_CHAOS / "run-backup-drill.sh").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def chaos_runbook() -> str:
    return (_REPO / "docs" / "ops" / "chaos-drills.md").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def backup_runbook() -> str:
    return (_REPO / "docs" / "ops" / "backup-restore.md").read_text(encoding="utf-8")


# ── TestKillPostgresScript ──────────────────────────────────────────────────

class TestKillPostgresScript:
    def test_has_posix_shebang(self, kill_sh):
        """/bin/sh (not /bin/bash) — the script should run on alpine too
        if anyone ever runs it from inside a container."""
        assert kill_sh.startswith("#!/bin/sh\n")

    def test_has_set_eu(self, kill_sh):
        """Without `set -eu`, a failed `docker compose stop` would let the
        drill march on to probes that then fail for the wrong reason."""
        assert re.search(r"^set -eu$", kill_sh, re.MULTILINE)

    def test_probes_both_health_endpoints(self, kill_sh):
        """The contract we're verifying is liveness AND readiness —
        if the drill only checks one, a regression in the other slips."""
        assert "/api/v1/healthz" in kill_sh
        assert "/api/v1/readyz" in kill_sh

    def test_asserts_readyz_flips_to_503_when_pg_down(self, kill_sh):
        """If the drill doesn't assert 503 for readyz with PG down, it
        doesn't actually test the degradation — it just tests that the
        app survives."""
        # Look for a probe call with readyz + 503 on the same logical line.
        assert re.search(r"probe\s+/api/v1/readyz\s+503", kill_sh)

    def test_asserts_healthz_stays_200_when_pg_down(self, kill_sh):
        """Liveness must NOT depend on PG — if healthz also 503s, k8s
        will restart the pod instead of taking it out of rotation, and
        recovery becomes a restart-loop problem."""
        # Both baseline and degradation steps expect healthz=200.
        healthz_200_count = len(re.findall(r"probe\s+/api/v1/healthz\s+200", kill_sh))
        assert healthz_200_count >= 2, (
            "expected healthz=200 assertion at both baseline AND degradation steps"
        )

    def test_restarts_postgres_on_abort(self, kill_sh):
        """If Ctrl-C leaves PG stopped, the developer's next command
        fails for no obvious reason. The trap must cover INT + TERM + EXIT."""
        assert "trap cleanup EXIT INT TERM" in kill_sh
        assert "docker compose start" in kill_sh

    def test_parameterizes_aziro_url(self, kill_sh):
        """Drills run both from the host (localhost:5000) and from inside
        the compose network (http://aziro:5000). A hard-coded URL locks
        out one of those modes."""
        assert 'AZIRO_URL="${AZIRO_URL:-http://localhost:5000}"' in kill_sh

    def test_waits_for_recovery_with_bounded_timeout(self, kill_sh):
        """An unbounded wait loop turns a PG-won't-restart bug into a
        hanging drill. Bound it so CI fails cleanly."""
        assert 'WAIT_SECONDS="${WAIT_SECONDS:-30}"' in kill_sh
        assert "wait_for_readyz_ok" in kill_sh

    def test_all_curl_calls_have_explicit_timeouts(self, kill_sh):
        """Without --max-time, a hung socket stalls the drill for curl's
        default (~120s), which blurs pass/fail. Every curl invocation
        must bound both connect and overall time."""
        # Find every `curl ` invocation (treat backslash-newlines as the
        # same logical call) and assert each has both bounds.
        curl_calls = re.findall(
            r"curl\s[^\n]*(?:\\\s*\n[^\n]*)*",
            kill_sh,
        )
        assert curl_calls, "expected at least one curl invocation"
        for call in curl_calls:
            assert "--connect-timeout" in call, (
                f"curl missing --connect-timeout: {call[:120]}"
            )
            assert "--max-time" in call, (
                f"curl missing --max-time: {call[:120]}"
            )


# ── TestRunBackupDrillScript ────────────────────────────────────────────────

class TestRunBackupDrillScript:
    def test_has_posix_shebang(self, drill_sh):
        assert drill_sh.startswith("#!/bin/sh\n")

    def test_has_set_eu(self, drill_sh):
        assert re.search(r"^set -eu$", drill_sh, re.MULTILINE)

    def test_invokes_both_backup_scripts(self, drill_sh):
        """The drill is thin — its job is to trigger backup.sh AND
        restore-verify.sh, not re-implement them."""
        assert "/usr/local/bin/backup.sh" in drill_sh
        assert "/usr/local/bin/restore-verify.sh" in drill_sh

    def test_snapshots_object_count_before_and_after(self, drill_sh):
        """A drill that calls backup.sh without checking that an object
        actually landed in MinIO would pass even if mc cp silently no-op'd."""
        # Two `mc ls --recursive` snapshots bracket the backup.sh call.
        mc_ls_count = drill_sh.count("mc ls --recursive")
        assert mc_ls_count >= 2, (
            f"expected 2+ mc ls snapshots (before+after), got {mc_ls_count}"
        )

    def test_fails_if_object_count_did_not_increase(self, drill_sh):
        """The assertion is the test. Without it, 'backup.sh exited 0' is
        the only signal — which isn't the same as 'a backup exists'."""
        assert re.search(r'if\s*\[\s*"\$_after"\s*-le\s*"\$_before"\s*\]', drill_sh)
        assert re.search(r"exit\s+1", drill_sh)

    def test_uses_docker_compose_exec_not_docker_exec(self, drill_sh):
        """`docker exec` needs a container name which varies by compose
        project prefix; `docker compose exec` uses the service name and
        Just Works regardless of project-name munging."""
        assert "docker compose exec" in drill_sh
        assert re.search(r"^\s*docker exec\b", drill_sh, re.MULTILINE) is None

    def test_mc_ls_pipelines_use_pipefail(self, drill_sh):
        """`mc ls | wc -l` without pipefail swallows mc's exit code —
        a failed listing (wrong alias, unreachable MinIO) then looks
        identical to an empty bucket, which can mask a real outage.
        Every `mc ls` pipeline inside a `sh -c` must set pipefail first."""
        # Find every `sh -c '...mc ls...'` and assert pipefail is set
        # inside. Using a non-greedy match so multiple sh -c blocks are
        # checked independently.
        sh_c_blocks = re.findall(
            r"sh -c\s+\\?\s*\n?\s*'([^']*mc ls[^']*)'",
            drill_sh,
            re.MULTILINE,
        )
        assert sh_c_blocks, "expected at least one `sh -c '…mc ls…'` invocation"
        for block in sh_c_blocks:
            assert "set -o pipefail" in block, (
                f"mc ls pipeline missing `set -o pipefail`: {block[:120]}"
            )


# ── TestChaosRunbook ────────────────────────────────────────────────────────

class TestChaosRunbook:
    def test_documents_both_drills(self, chaos_runbook):
        assert "kill-postgres" in chaos_runbook
        assert "run-backup-drill" in chaos_runbook

    def test_shows_pass_output_for_both(self, chaos_runbook):
        """A runbook without a sample pass output forces the reader to
        guess what 'success' looks like — which is what makes runbooks
        useless at 2am."""
        assert "drill passed" in chaos_runbook
        # Both drills should show their pass banner example.
        drill_passed_count = chaos_runbook.count("drill passed")
        assert drill_passed_count >= 2

    def test_calls_out_env_overrides(self, chaos_runbook):
        """AZIRO_URL parameterization is meaningless if the runbook
        doesn't mention when to set it."""
        assert "AZIRO_URL" in chaos_runbook
        assert "PG_CONTAINER" in chaos_runbook
        assert "WAIT_SECONDS" in chaos_runbook

    def test_has_loki_query_section(self, chaos_runbook):
        """Drills share Loki labels with the nightly cron; the runbook
        should say so, otherwise ops hunts for a drill-specific label
        that doesn't exist."""
        assert "com_aziro_service=\"backup\"" in chaos_runbook
        assert "aziro-restore-verify" in chaos_runbook

    def test_has_troubleshooting_sections(self, chaos_runbook):
        """Every drill has a non-empty failure mode. If the runbook
        doesn't enumerate them, the first real failure becomes an
        exploratory debugging session at the worst possible time."""
        assert "Troubleshooting" in chaos_runbook


# ── TestCrossRef ────────────────────────────────────────────────────────────

class TestCrossRef:
    def test_backup_runbook_points_at_chaos_runbook(self, backup_runbook):
        """Someone reading the backup runbook should know the drill
        exists — otherwise they reinvent `docker compose exec backup
        /usr/local/bin/backup.sh` by hand every time."""
        assert "chaos-drills" in backup_runbook
