#!/bin/sh
# =============================================================================
# minio-bucket-init.sh — idempotent MinIO bucket + lifecycle setup
# =============================================================================
# Runs once at first `docker compose up` against a fresh MinIO volume,
# and is safe to re-run thereafter (every operation checks-or-creates).
# Owned by the backup sidecar so the MinIO container itself stays stock.
#
# Creates:
#   - Bucket aziro-backups (private; no public read)
#   - Lifecycle rule: expire objects older than 30 days
#
# No user accounts beyond MINIO_ROOT_USER are provisioned — rotating the
# root credential (`mc admin user rotate`) is the ops response to a
# suspected compromise, not creating a second account. Scoped API keys
# land in DB-4.1 if we later need separate backup vs restore permissions.
# =============================================================================

set -eu

BUCKET="${MINIO_BUCKET:-aziro-backups}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"
MC_ALIAS="aziro"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

log() {
  _level="$1"; shift
  _msg="$1"; shift
  _obj=$(jq -cn \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg level "$_level" \
    --arg msg "$_msg" \
    '{ts:$ts, level:$level, component:"aziro-minio-init", msg:$msg}')
  for _kv in "$@"; do
    _k="${_kv%%=*}"
    _v="${_kv#*=}"
    _obj=$(printf '%s' "$_obj" | jq -c --arg k "$_k" --arg v "$_v" '. + {($k): $v}')
  done
  printf '%s\n' "$_obj"
}

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER not set — populate .env}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD not set — populate .env}"

log info "starting bucket init"

mc alias set "$MC_ALIAS" "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" \
  >/dev/null 2>&1

# `mc mb --ignore-existing` is idempotent — succeeds whether the bucket
# was just created or already existed.
mc mb --ignore-existing "${MC_ALIAS}/${BUCKET}" >/dev/null

# Default bucket policy on MinIO is "none" (private). Make it explicit
# so a future `mc anonymous set public` mistake is caught by the next
# init re-run.
mc anonymous set none "${MC_ALIAS}/${BUCKET}" >/dev/null 2>&1 || true

# Lifecycle rule — objects older than N days are deleted. `mc ilm rule
# add` is idempotent if we always use the same rule id (`aziro-retention`).
# The `--expire-days` form handles the GC; MinIO runs the scan hourly.
mc ilm rule add \
  --expire-days "${RETENTION_DAYS}" \
  --id "aziro-retention" \
  "${MC_ALIAS}/${BUCKET}" \
  >/dev/null 2>&1 || \
mc ilm rule edit \
  --expire-days "${RETENTION_DAYS}" \
  --id "aziro-retention" \
  "${MC_ALIAS}/${BUCKET}" \
  >/dev/null 2>&1 || true

log info "bucket init complete" "bucket=${BUCKET}" "retention_days=${RETENTION_DAYS}"
