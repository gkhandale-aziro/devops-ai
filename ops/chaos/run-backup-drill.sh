#!/bin/sh
# =============================================================================
# run-backup-drill.sh — REL-1 chaos drill: trigger backup + restore-verify
# =============================================================================
# Normally `backup.sh` and `restore-verify.sh` run on the Ofelia cron (02:00
# and 02:30 UTC). For a drill or demo we want to trigger them on demand and
# get a clear pass/fail signal in the foreground.
#
# What it proves:
#   - pg_dump against the live postgres produces a non-empty archive
#   - mc uploads it to the aziro-backups bucket (object count +1)
#   - pg_restore into a scratch DB succeeds
#   - schema + row counts match the live DB
#
# Failure modes surfaced:
#   - MinIO unreachable / wrong creds → mc alias set fails (backup.sh)
#   - pg_dump version mismatch → the dump aborts (backup.sh)
#   - pg_restore ACL/ownership drift → --no-owner saved us (restore-verify.sh)
#   - Bucket lifecycle misconfig → object count doesn't increment
#
# Usage:
#   ./ops/chaos/run-backup-drill.sh
# =============================================================================

set -eu

BACKUP_SVC="${BACKUP_SVC:-backup}"

say() { printf '[drill] %s\n' "$*"; }

say "=== REL-1 chaos drill: run-backup-drill ==="

say "step 1/4 — snapshot MinIO object count before backup"
# `mc ls --recursive` against the bucket; the count line is what we compare.
# Running inside the sidecar so we reuse its `mc` alias + creds rather than
# plumbing them out to the host shell.
#
# `set -o pipefail` is critical here: without it, `mc ls | wc -l` returns
# wc's exit code (always 0 on a valid stream, even an empty one from a
# failed mc). A misconfigured alias or unreachable MinIO would then look
# like "0 objects" — which compared to post-backup "0 objects" would
# trigger a false-negative drill failure OR worse, mask a real backup
# outage. Alpine's ash supports pipefail.
_before=$(docker compose exec -T "$BACKUP_SVC" sh -c \
  'set -o pipefail; mc ls --recursive aziro/aziro-backups | wc -l' \
  | tr -d '[:space:]')
say "  objects before: ${_before}"

say "step 2/4 — triggering backup.sh"
_t0=$(date +%s)
docker compose exec -T "$BACKUP_SVC" /usr/local/bin/backup.sh
_t1=$(date +%s)
say "  backup.sh completed in $((_t1 - _t0))s"

say "step 3/4 — verifying object count incremented"
_after=$(docker compose exec -T "$BACKUP_SVC" sh -c \
  'set -o pipefail; mc ls --recursive aziro/aziro-backups | wc -l' \
  | tr -d '[:space:]')
say "  objects after: ${_after}"
if [ "$_after" -le "$_before" ]; then
  say "  ✗ object count did not increase (${_before} → ${_after})"
  exit 1
fi
say "  ✓ object count increased by $((_after - _before))"

say "step 4/4 — triggering restore-verify.sh"
_t0=$(date +%s)
docker compose exec -T "$BACKUP_SVC" /usr/local/bin/restore-verify.sh
_t1=$(date +%s)
say "  restore-verify.sh completed in $((_t1 - _t0))s"

say "=== drill passed ==="
