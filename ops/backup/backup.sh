#!/bin/sh
# =============================================================================
# backup.sh — nightly pg_dump → MinIO
# =============================================================================
# Runs inside the backup sidecar container. Invoked by ofelia at 02:00 UTC
# (see ofelia.job-exec.backup.schedule on the backup service in
# docker-compose.yml).
#
# Env vars (all injected via env_file: .env in compose):
#   AZIRO_DB_URL           psycopg DSN; we strip `+psycopg` for libpq
#   MINIO_ENDPOINT         e.g. http://minio:9000 (defaulted below)
#   MINIO_ROOT_USER        MinIO access key
#   MINIO_ROOT_PASSWORD    MinIO secret key
#
# Exit codes:
#   0   dump uploaded and mc reports success
#   1   missing env, pg_dump failure, or mc cp failure
#
# Output: one JSON log line per state transition on stdout. Loki scrapes
# this via the com.aziro.logs=true container label; the schema matches
# aziro-py's structlog output (ts / level / component / msg + extras).
# =============================================================================

set -eu

BUCKET="${MINIO_BUCKET:-aziro-backups}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"
MC_ALIAS="aziro"

# ── Logging helper ──────────────────────────────────────────────────────────
# jq builds JSON safely (handles quoting / unicode). Every log line includes
# component=aziro-backup so Loki queries can filter cleanly. Extra args
# are "key=value" strings appended as additional top-level fields.
log() {
  _level="$1"; shift
  _msg="$1"; shift
  _obj=$(jq -cn \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg level "$_level" \
    --arg msg "$_msg" \
    '{ts:$ts, level:$level, component:"aziro-backup", msg:$msg}')
  for _kv in "$@"; do
    _k="${_kv%%=*}"
    _v="${_kv#*=}"
    _obj=$(printf '%s' "$_obj" | jq -c --arg k "$_k" --arg v "$_v" '. + {($k): $v}')
  done
  printf '%s\n' "$_obj"
}

fail() {
  log error "$1"
  exit 1
}

# ── Preflight ──────────────────────────────────────────────────────────────
: "${AZIRO_DB_URL:?AZIRO_DB_URL not set — populate .env}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER not set — populate .env}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD not set — populate .env}"

# pg_dump wants a libpq URL, not psycopg's. Strip the dialect marker.
PG_URL=$(printf '%s' "$AZIRO_DB_URL" | sed 's|^postgresql+psycopg://|postgresql://|')

# ── Dump ───────────────────────────────────────────────────────────────────
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DATE_PATH=$(date -u +%Y/%m/%d)
DUMP_FILE="/tmp/db-${STAMP}.dump"

log info "starting backup" "stamp=${STAMP}"

pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$DUMP_FILE" \
  "$PG_URL" \
  || fail "pg_dump failed"

# Use stat for byte count — portable between GNU (-c%s) and BSD (-f%z).
SIZE=$(wc -c < "$DUMP_FILE" | tr -d ' ')
log info "dump created" "bytes=${SIZE}" "file=${DUMP_FILE}"

# ── Upload ─────────────────────────────────────────────────────────────────
mc alias set "$MC_ALIAS" "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" \
  >/dev/null 2>&1 || fail "mc alias set failed"

REMOTE_PATH="${MC_ALIAS}/${BUCKET}/${DATE_PATH}/db-${STAMP}.dump"
mc cp "$DUMP_FILE" "$REMOTE_PATH" >/dev/null || fail "mc cp failed"

log info "backup complete" "path=${BUCKET}/${DATE_PATH}/db-${STAMP}.dump" "bytes=${SIZE}"

# Housekeeping — the sidecar's /tmp is a volume, so left-behind dumps
# add up over time. Keep only the most recent dump locally as a fast
# rollback option (MinIO remains the source of truth).
find /tmp -maxdepth 1 -name 'db-*.dump' -mtime +1 -delete 2>/dev/null || true
