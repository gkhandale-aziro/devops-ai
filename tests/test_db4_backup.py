"""
tests/test_db4_backup.py — static checks for the DB-4 backup pipeline.

Running pg_dump → MinIO → restore end-to-end needs a live Postgres +
MinIO container pair, which is a manual drill (documented in
docs/ops/backup-restore.md). What we CAN guarantee in CI is that the
shell scripts, Dockerfile, and compose wiring all contain the pieces
that make the drill possible — that way a typo in the cron schedule or
a missing pg_dump flag fails here rather than at 2am Wednesday.

The tests are split into:

    TestBackupScript         — backup.sh contents
    TestRestoreVerifyScript  — restore-verify.sh contents
    TestBucketInitScript     — minio-bucket-init.sh contents
    TestBackupDockerfile     — sidecar image has the tools the scripts need
    TestComposeWiring        — services + labels + volumes in docker-compose.yml
    TestEnvExampleDocsMinIO  — .env.example documents the MinIO creds
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

_REPO = Path(__file__).resolve().parent.parent
_OPS = _REPO / "ops" / "backup"


# ── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def backup_sh() -> str:
    """Raw text of ops/backup/backup.sh — the nightly pg_dump uploader."""
    return (_OPS / "backup.sh").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def restore_sh() -> str:
    """Raw text of ops/backup/restore-verify.sh — the restore drill."""
    return (_OPS / "restore-verify.sh").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def init_sh() -> str:
    """Raw text of ops/backup/minio-bucket-init.sh — one-shot bootstrap."""
    return (_OPS / "minio-bucket-init.sh").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def dockerfile() -> str:
    """Raw text of the backup sidecar Dockerfile."""
    return (_OPS / "Dockerfile").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def compose() -> dict:
    """Parsed docker-compose.yml as a dict."""
    return yaml.safe_load((_REPO / "docker-compose.yml").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def env_example() -> str:
    """Raw text of .env.example — operator-facing config template."""
    return (_REPO / ".env.example").read_text(encoding="utf-8")


# ── TestBackupScript ────────────────────────────────────────────────────────

class TestBackupScript:
    def test_uses_pg_dump_custom_compressed_format(self, backup_sh):
        """pg_dump --format=custom is the only form pg_restore can replay
        selectively; --compress=9 keeps archives small enough that a
        month of dumps fits on the MinIO volume without GC churn."""
        assert "--format=custom" in backup_sh
        assert "--compress=9" in backup_sh

    def test_strips_psycopg_dialect_for_libpq(self, backup_sh):
        """AZIRO_DB_URL in .env uses the psycopg dialect; libpq (pg_dump)
        doesn't understand it. Script must rewrite to plain postgresql://."""
        assert "postgresql+psycopg://" in backup_sh
        assert "postgresql://" in backup_sh

    def test_uploads_to_minio_with_mc_cp(self, backup_sh):
        """Upload path: `mc cp <local> aziro/<bucket>/<date>/<file>`.
        Without this the dump stays on the sidecar's /tmp and ages out
        without ever reaching durable storage."""
        assert "mc alias set" in backup_sh
        assert "mc cp" in backup_sh

    def test_fails_fast_on_missing_env(self, backup_sh):
        """POSIX `${VAR:?msg}` pattern — shell exits non-zero on unset
        var before any side-effect. Required for the cron exit code to
        mean 'the backup ran and succeeded' rather than 'the script
        silently no-op'd because the env wasn't wired'."""
        assert "${AZIRO_DB_URL:?" in backup_sh
        assert "${MINIO_ROOT_USER:?" in backup_sh
        assert "${MINIO_ROOT_PASSWORD:?" in backup_sh

    def test_exits_on_step_error(self, backup_sh):
        """`set -eu` short-circuits the script on any non-zero exit —
        critical so a failed pg_dump doesn't silently upload an empty
        file over the previous night's good backup."""
        assert "set -eu" in backup_sh

    def test_emits_structured_log(self, backup_sh):
        """Loki ingests container stdout; aziro-py emits one JSON line
        per structlog event. backup.sh must do the same so nightly runs
        show up in the same Grafana dashboard as app events."""
        assert '"component":"aziro-backup"' in backup_sh or \
               "aziro-backup" in backup_sh  # jq builds it dynamically
        assert "jq" in backup_sh  # ensures JSON construction, not printf

    def test_dump_path_includes_ymd_prefix(self, backup_sh):
        """Remote path is aziro-backups/YYYY/MM/DD/db-<stamp>.dump so
        the MinIO lifecycle rule can prefix-scan efficiently and ops
        can `mc ls aziro-backups/2026/04/` to browse a month."""
        assert "date -u +%Y/%m/%d" in backup_sh


# ── TestRestoreVerifyScript ─────────────────────────────────────────────────

class TestRestoreVerifyScript:
    def test_downloads_latest_dump(self, restore_sh):
        """`mc ls --recursive` → sort → tail -1 picks the newest dump
        regardless of how many days of backups sit under the prefix."""
        assert "mc ls --recursive" in restore_sh
        assert "mc cp" in restore_sh

    def test_uses_scratch_db(self, restore_sh):
        """Restore target is a separate `aziro_verify` database, not
        the live `aziro`. Otherwise a bad dump would clobber production."""
        assert "aziro_verify" in restore_sh
        assert "CREATE DATABASE" in restore_sh

    def test_scratch_db_cleaned_up_on_exit(self, restore_sh):
        """`trap cleanup EXIT` runs DROP DATABASE even on mid-script
        failure — without this an aborted run wedges the next night's
        attempt because `CREATE DATABASE` errors on an existing name."""
        assert "trap cleanup EXIT" in restore_sh
        assert "DROP DATABASE IF EXISTS" in restore_sh
        # WITH (FORCE) kicks lingering sessions; PG 13+.
        assert "WITH (FORCE)" in restore_sh

    def test_pg_restore_exits_on_error(self, restore_sh):
        """`--exit-on-error` turns pg_restore's per-object warnings into
        a script-level failure. A silent warning on a missing FK would
        produce a DB the app later trips over at runtime."""
        assert "pg_restore" in restore_sh
        assert "--exit-on-error" in restore_sh

    def test_schema_diff_check(self, restore_sh):
        """If the restored schema drifts from live, something in the
        backup chain lost DDL — likely a dropped extension or a
        post-migration schema change that didn't make it into the dump."""
        assert "pg_dump --schema-only" in restore_sh
        assert "diff" in restore_sh

    def test_schema_diff_strips_pg16_restrict_nonces(self, restore_sh):
        r"""Postgres 16's pg_dump emits \restrict <nonce> and \unrestrict
        <nonce> psql meta-commands with a FRESHLY RANDOMISED token on
        every run. Diffing the raw files guarantees drift on every
        drill — which is exactly what took restore-verify down the
        first time §4.4 ran on the v1.0 VM. Strip both lines before
        diff or the release gate is a coin flip, not a contract."""
        assert r"^\\restrict " in restore_sh or r"^\\restrict" in restore_sh, \
            "restore-verify must filter \\restrict nonces before diff"
        assert r"^\\unrestrict " in restore_sh or r"^\\unrestrict" in restore_sh, \
            "restore-verify must filter \\unrestrict nonces before diff"

    def test_row_count_smoke_check(self, restore_sh):
        """Risk #6 from docs/db-v1-plan.md: an empty dump restores
        cleanly and matches the empty-live schema — silently passing
        verify. Row-count comparison catches this."""
        assert "SELECT COUNT(*) FROM events" in restore_sh
        assert "row count regression" in restore_sh or \
               "RESTORED_COUNT" in restore_sh


# ── TestBucketInitScript ────────────────────────────────────────────────────

class TestBucketInitScript:
    def test_creates_bucket_idempotently(self, init_sh):
        """`mc mb --ignore-existing` is a no-op when the bucket exists,
        which is the desired behaviour every time the backup sidecar
        restarts (the script runs at container start via CMD)."""
        assert "mc mb" in init_sh
        assert "--ignore-existing" in init_sh

    def test_applies_lifecycle_rule(self, init_sh):
        """30-day expiry via `mc ilm rule add`. Without this, backups
        grow unbounded — the v1.0 exit gate explicitly requires that
        backups older than 30 days are GC'd."""
        assert "mc ilm rule" in init_sh
        assert "--expire-days" in init_sh

    def test_enforces_private_bucket(self, init_sh):
        """Risk #7: a leaked public bucket URL exposes PII in every
        dump. Explicit `mc anonymous set none` defeats a stray
        `set public` mistake by the next init re-run."""
        assert "mc anonymous set none" in init_sh

    def test_mc_alias_set_has_error_handling(self, backup_sh, restore_sh, init_sh):
        """All three scripts pipe mc errors to /dev/null so the operator
        doesn't see credential strings in stdout. Without explicit
        error-handling on `mc alias set`, an auth failure flows through
        silently and the next mc call fails with a confusing "alias not
        found" error. Every script must catch and surface the real cause.

        The mc alias set command is always written on one logical line
        that ends with a line-continuation `\\` followed by either
        `|| fail "..."` (backup/restore pattern) or `|| { log error ...;
        exit 1; }` (init pattern). The regex accepts either form and
        rejects a bare `mc alias set ...` with nothing after."""
        pattern = re.compile(
            r"mc alias set[^\n]*(?:\\\s*\n[^\n]*)*\|\|\s*(?:fail|\{)",
            re.MULTILINE,
        )
        for name, body in [("backup", backup_sh),
                           ("restore-verify", restore_sh),
                           ("minio-bucket-init", init_sh)]:
            assert pattern.search(body), (
                f"{name}.sh: mc alias set lacks explicit error handling "
                "(expect `|| fail \"...\"` or `|| { log error ...; exit 1; }`)"
            )


# ── TestBackupDockerfile ────────────────────────────────────────────────────

class TestBackupDockerfile:
    def test_uses_pinned_alpine(self, dockerfile):
        """Reproducible builds — `FROM alpine` alone can shift under
        you as the tag moves; pin to a specific major.minor."""
        assert "FROM alpine:3." in dockerfile

    def test_installs_postgresql_client(self, dockerfile):
        """pg_dump / pg_restore / psql live in postgresql16-client.
        Version-matched to the postgres:16 server so protocol wire
        formats agree."""
        assert "postgresql16-client" in dockerfile

    def test_installs_jq_for_json_logs(self, dockerfile):
        """Scripts build Loki-parsable JSON with jq — if it's missing
        the log helper silently falls back to bare printf and Loki
        loses the component/level fields."""
        assert "jq" in dockerfile

    def test_pins_mc_release(self, dockerfile):
        """mc has no alpine package; we pull a binary. Pinned so a
        mid-day MinIO release doesn't break the next rebuild."""
        assert "MC_VERSION" in dockerfile
        assert "mc --version" in dockerfile  # smoke check during build


# ── TestComposeWiring ───────────────────────────────────────────────────────

class TestComposeWiring:
    def test_minio_service_present(self, compose):
        """MinIO must be a first-class compose service, not ad-hoc — so
        it boots with the stack and gets the same restart policy."""
        assert "minio" in compose["services"]
        m = compose["services"]["minio"]
        assert "image" in m
        assert "minio/minio" in m["image"]
        assert m.get("restart") == "unless-stopped"

    def test_minio_has_healthcheck(self, compose):
        """Without a healthcheck, the backup service would boot before
        MinIO is ready and `mc alias set` would hit a closed port."""
        m = compose["services"]["minio"]
        assert "healthcheck" in m
        # `mc ready local` is MinIO's canonical readiness probe — the
        # test: list is e.g. ["CMD", "mc", "ready", "local"], so check
        # the joined string, not each item in isolation.
        joined = " ".join(m["healthcheck"]["test"])
        assert "mc" in joined and "ready" in joined

    def test_backup_service_builds_from_ops(self, compose):
        """Sidecar is built from ops/backup so changes ship with the
        repo, not as an opaque pre-built image pinned to a digest."""
        b = compose["services"]["backup"]
        assert b.get("build") == "./ops/backup"

    def test_backup_waits_on_postgres_and_minio(self, compose):
        """Both deps must be service_healthy — partial readiness would
        cause the bootstrap to fail its bucket-init step and the
        container to crash-loop."""
        b = compose["services"]["backup"]
        deps = b["depends_on"]
        assert deps["postgres"]["condition"] == "service_healthy"
        assert deps["minio"]["condition"] == "service_healthy"

    def test_backup_runs_bucket_init_at_start(self, compose):
        """Fresh MinIO volume needs the bucket + lifecycle rule before
        the first scheduled backup fires at 02:00 UTC. Running the init
        inline in the backup command guarantees it happens once per
        container lifetime, idempotent thereafter."""
        b = compose["services"]["backup"]
        cmd = " ".join(b["command"]) if isinstance(b["command"], list) \
            else str(b["command"])
        assert "minio-bucket-init.sh" in cmd
        assert "sleep infinity" in cmd

    def test_ofelia_has_docker_socket_mount(self, compose):
        """Ofelia invokes `docker exec` against the backup container.
        Read-only socket mount is the grant; daemon mode is how it
        discovers the labelled container."""
        o = compose["services"]["ofelia"]
        mounts = o["volumes"]
        assert any("/var/run/docker.sock" in m and ":ro" in m for m in mounts)
        assert "daemon" in o["command"]
        assert "--docker" in o["command"]

    def test_ofelia_image_tag_exists_on_dockerhub(self, compose):
        """mcuadros/ofelia publishes tags as `0.3.22`, NOT `v0.3.22`.
        A `v`-prefixed tag pulls as `manifest unknown` and kills a fresh
        deploy at `docker compose up` — one of the real v1.0 VM blockers."""
        import re
        image = compose["services"]["ofelia"]["image"]
        assert image.startswith("mcuadros/ofelia:"), image
        tag = image.split(":", 1)[1]
        assert re.fullmatch(r"\d+\.\d+\.\d+", tag), (
            f"ofelia tag must be N.N.N (no v-prefix, no 'latest'): got {tag!r}"
        )

    def test_backup_labels_declare_cron_schedule(self, compose):
        """Labels are how ofelia learns what to run. Schedule values
        use 6-field cron (sec min hour dom mon dow) — ofelia's format,
        not std cron — so a blind copy-paste of `0 2 * * *` would
        silently run every second of 2am, not once at 02:00:00."""
        labels = compose["services"]["backup"]["labels"]
        assert labels["ofelia.enabled"] == "true"
        # backup at 02:00 UTC, restore-verify at 02:30 UTC.
        assert labels["ofelia.job-exec.backup.schedule"] == "0 0 2 * * *"
        assert labels["ofelia.job-exec.restore-verify.schedule"] == \
            "0 30 2 * * *"
        assert labels["ofelia.job-exec.backup.command"] == \
            "/usr/local/bin/backup.sh"
        assert labels["ofelia.job-exec.restore-verify.command"] == \
            "/usr/local/bin/restore-verify.sh"

    def test_volumes_declared(self, compose):
        """Named volumes survive `docker compose down`. Backups
        definitely should; the backup-tmp volume is just convenience
        but avoids writing to the container layer."""
        volumes = compose["volumes"]
        assert "aziro-minio-data" in volumes
        assert "aziro-backup-tmp" in volumes

    def test_logs_label_on_backup_services(self, compose):
        """Loki's Alloy config scrapes containers with com.aziro.logs=true.
        Without this label the backup/ofelia/minio stdout never reaches
        the dashboard and a failing restore drill is invisible."""
        for svc in ("minio", "backup", "ofelia"):
            labels = compose["services"][svc]["labels"]
            assert labels["com.aziro.logs"] == "true", svc


# ── TestEnvExampleDocsMinIO ─────────────────────────────────────────────────

class TestEnvExampleDocsMinIO:
    def test_documents_minio_root_creds(self, env_example):
        """Operators copying .env.example → .env must see these as
        required; no sensible default (leaving them unset) exists
        because MinIO would fall back to minioadmin/minioadmin."""
        assert "MINIO_ROOT_USER" in env_example
        assert "MINIO_ROOT_PASSWORD" in env_example
        assert "REPLACE-WITH-GENERATED-TOKEN" in env_example

    def test_points_to_generator(self, env_example):
        """Match the DB-3 password guidance — one canonical generator
        command so operators aren't tempted to type `password123`."""
        assert "secrets.token_urlsafe(32)" in env_example
