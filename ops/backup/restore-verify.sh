#!/bin/sh
# =============================================================================
# restore-verify.sh — nightly restore drill
# =============================================================================
# Invoked by ofelia at 02:30 UTC (30 min after backup.sh). Proves the
# latest dump in MinIO is actually restorable by:
#   1. Downloading the newest dump from aziro-backups/
#   2. Restoring it into a scratch database on the live Postgres
#   3. Diffing the scratch schema against live — any drift → exit 1
#   4. Asserting the restored events row count matches live (risk #6:
#      empty dump silently passing)
#   5. Dropping the scratch DB on exit
#
# This is the heart of v1.0 exit-gate item "One successful restore drill
# executed against a real backup". Every night the check runs; Loki alerts
# page ops if it exits non-zero.
#
# Why scratch DB on the same server (not a second container): reuses the
# already-running postgres, avoids managing a second server's lifecycle,
# and works with the shared_preload_libraries setting already applied.
# The scratch DB is always dropped WITH (FORCE) so an aborted drill from
# the prior night doesn't wedge the next run.
# =============================================================================

set -eu

BUCKET="${MINIO_BUCKET:-aziro-backups}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"
MC_ALIAS="aziro"
SCRATCH_DB="aziro_verify"

# ── Logging helper (same shape as backup.sh) ────────────────────────────────
log() {
  _level="$1"; shift
  _msg="$1"; shift
  _obj=$(jq -cn \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg level "$_level" \
    --arg msg "$_msg" \
    '{ts:$ts, level:$level, component:"aziro-restore-verify", msg:$msg}')
  for _kv in "$@"; do
    _k="${_kv%%=*}"
    _v="${_kv#*=}"
    _obj=$(printf '%s' "$_obj" | jq -c --arg k "$_k" --arg v "$_v" '. + {($k): $v}')
  done
  printf '%s\n' "$_obj"
}

cleanup() {
  # Always drop the scratch DB, even on mid-run failure. WITH (FORCE)
  # kicks any lingering connection so a half-run prior night doesn't
  # wedge tonight's run.
  if [ -n "${ADMIN_URL:-}" ]; then
    psql "$ADMIN_URL" -v ON_ERROR_STOP=0 \
      -c "DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE);" \
      >/dev/null 2>&1 || true
  fi
  rm -f /tmp/verify.dump \
        /tmp/live-schema.sql     /tmp/restored-schema.sql \
        /tmp/live-schema.clean   /tmp/restored-schema.clean \
        2>/dev/null || true
}
trap cleanup EXIT

fail() {
  log error "$1"
  exit 1
}

# ── Preflight ──────────────────────────────────────────────────────────────
: "${AZIRO_DB_URL:?AZIRO_DB_URL not set — populate .env}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER not set — populate .env}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD not set — populate .env}"

PG_URL=$(printf '%s' "$AZIRO_DB_URL" | sed 's|^postgresql+psycopg://|postgresql://|')
# Admin URL points at the `postgres` maintenance DB so we can CREATE /
# DROP the scratch DB without connecting to it.
ADMIN_URL=$(printf '%s' "$PG_URL" | sed 's|/aziro\(?.*\)\{0,1\}$|/postgres|')
SCRATCH_URL=$(printf '%s' "$PG_URL" | sed "s|/aziro\\(?.*\\)\\{0,1\\}\$|/${SCRATCH_DB}|")

log info "starting restore-verify"

# ── Download latest dump ───────────────────────────────────────────────────
mc alias set "$MC_ALIAS" "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" \
  >/dev/null 2>&1 || fail "mc alias set failed"

# mc ls --recursive lists every object under the bucket. Sort by the
# path (starts with YYYY/MM/DD/db-<stamp>.dump) so the last line is the
# newest; that's the one we verify.
LATEST=$(mc ls --recursive "${MC_ALIAS}/${BUCKET}/" 2>/dev/null \
  | awk '{print $NF}' \
  | grep -E '\.dump$' \
  | sort \
  | tail -1 || true)

if [ -z "$LATEST" ]; then
  fail "no backup found in ${BUCKET}"
fi

log info "found latest dump" "path=${LATEST}"

mc cp "${MC_ALIAS}/${BUCKET}/${LATEST}" /tmp/verify.dump >/dev/null \
  || fail "mc cp (download) failed"

# ── Capture live baseline ─────────────────────────────────────────────────
# Row count: guard against silent empty-dump regression (risk #6). We
# compare the count in the restored DB to this baseline.
LIVE_COUNT=$(psql "$PG_URL" -tAc "SELECT COUNT(*) FROM events" 2>/dev/null || echo "-1")
if [ "$LIVE_COUNT" = "-1" ]; then
  fail "failed to read live events count"
fi

# ── Rebuild scratch DB ─────────────────────────────────────────────────────
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE);" \
  -c "CREATE DATABASE ${SCRATCH_DB} OWNER aziro;" \
  >/dev/null || fail "scratch DB create failed"

pg_restore \
  --dbname="$SCRATCH_URL" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  /tmp/verify.dump \
  >/dev/null 2>&1 \
  || fail "pg_restore failed"

# ── Schema diff ────────────────────────────────────────────────────────────
pg_dump --schema-only --no-owner --no-privileges "$PG_URL" \
  > /tmp/live-schema.sql 2>/dev/null \
  || fail "pg_dump (live schema) failed"
pg_dump --schema-only --no-owner --no-privileges "$SCRATCH_URL" \
  > /tmp/restored-schema.sql 2>/dev/null \
  || fail "pg_dump (restored schema) failed"

# Postgres 16's pg_dump emits `\restrict <nonce>` / `\unrestrict <nonce>`
# psql meta-commands with a newly-randomised token on every run. They
# gate interactive psql from executing untrusted SQL and are not part
# of the schema, but identical live vs restored schemas still diff
# here on every drill. Strip before comparison — the rest of the file
# is the real schema surface we want gated on drift.
grep -v '^\\restrict ' /tmp/live-schema.sql     | grep -v '^\\unrestrict ' > /tmp/live-schema.clean
grep -v '^\\restrict ' /tmp/restored-schema.sql | grep -v '^\\unrestrict ' > /tmp/restored-schema.clean

if ! diff -q /tmp/live-schema.clean /tmp/restored-schema.clean >/dev/null; then
  log error "schema drift detected between live and restored" \
    "live=/tmp/live-schema.clean" "restored=/tmp/restored-schema.clean"
  exit 1
fi

# ── Row count smoke check ─────────────────────────────────────────────────
RESTORED_COUNT=$(psql "$SCRATCH_URL" -tAc "SELECT COUNT(*) FROM events" 2>/dev/null \
  || echo "-1")

if [ "$RESTORED_COUNT" = "-1" ]; then
  fail "failed to read restored events count"
fi

# The dump must contain at least as many events as live now holds. It
# can legitimately have fewer only if events were deleted between the
# backup and the verify run — rare, and catching both regressions is
# more valuable than false-alarming on that edge case.
if [ "$RESTORED_COUNT" -lt "$LIVE_COUNT" ]; then
  log error "row count regression — dump is missing events" \
    "live=${LIVE_COUNT}" "restored=${RESTORED_COUNT}"
  exit 1
fi

log info "restore-verify complete" \
  "live_events=${LIVE_COUNT}" \
  "restored_events=${RESTORED_COUNT}" \
  "dump=${LATEST}"
