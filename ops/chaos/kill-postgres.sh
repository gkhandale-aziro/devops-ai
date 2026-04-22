#!/bin/sh
# =============================================================================
# kill-postgres.sh — REL-1 chaos drill: verify graceful PG-down degradation
# =============================================================================
# Stops the postgres container, asserts that the app responds correctly to
# LB probes (healthz stays 200, readyz flips to 503 with a db-fail check),
# restarts postgres, and asserts recovery.
#
# The contract we're verifying is the one k8s / a real LB actually uses —
# not every /api/* endpoint, just the probe endpoints. Individual endpoints
# that hit the store WILL 500 under DB-down; that's a separate app-hardening
# concern, not what this drill asserts.
#
# Usage:
#   ./ops/chaos/kill-postgres.sh                      # localhost:5000
#   AZIRO_URL=http://aziro:5000 ./ops/chaos/kill-postgres.sh   # inside compose net
#
# Safety:
#   A trap restarts postgres on any abort — if you Ctrl-C mid-drill, the
#   container comes back up instead of staying down.
# =============================================================================

set -eu

AZIRO_URL="${AZIRO_URL:-http://localhost:5000}"
PG_CONTAINER="${PG_CONTAINER:-postgres}"
WAIT_SECONDS="${WAIT_SECONDS:-30}"

# Restore postgres on abort — never leave the stack in a degraded state.
cleanup() {
  _ec=$?
  if [ "$_ec" -ne 0 ]; then
    printf '[chaos] aborted (exit=%s) — restoring postgres\n' "$_ec" >&2
    docker compose start "$PG_CONTAINER" >/dev/null 2>&1 || true
  fi
  exit "$_ec"
}
trap cleanup EXIT INT TERM

say() { printf '[chaos] %s\n' "$*"; }

probe() {
  # $1 = path, $2 = expected status. Returns 0 on match, non-zero otherwise.
  # --connect-timeout + --max-time bound the call so a hung socket can't
  # stall the drill — a real LB probe would time out in single-digit
  # seconds, so the drill should too.
  _path="$1"; _expected="$2"
  _code=$(curl -s --connect-timeout 3 --max-time 5 \
    -o /tmp/chaos-body.$$ -w '%{http_code}' \
    "${AZIRO_URL}${_path}" || echo "000")
  if [ "$_code" = "$_expected" ]; then
    say "  ${_path} → ${_code} (expected ${_expected}) ✓"
    rm -f /tmp/chaos-body.$$
    return 0
  fi
  say "  ${_path} → ${_code} (expected ${_expected}) ✗"
  [ -f /tmp/chaos-body.$$ ] && cat /tmp/chaos-body.$$ >&2
  rm -f /tmp/chaos-body.$$
  return 1
}

wait_for_readyz_ok() {
  _i=0
  while [ "$_i" -lt "$WAIT_SECONDS" ]; do
    _code=$(curl -s --connect-timeout 2 --max-time 3 \
      -o /dev/null -w '%{http_code}' \
      "${AZIRO_URL}/api/v1/readyz" || echo "000")
    if [ "$_code" = "200" ]; then
      say "  readyz recovered after ${_i}s"
      return 0
    fi
    _i=$((_i + 1))
    sleep 1
  done
  say "  readyz never recovered after ${WAIT_SECONDS}s"
  return 1
}

say "=== REL-1 chaos drill: kill-postgres ==="
say "target: ${AZIRO_URL}"

say "step 1/5 — baseline probes (both should be 200)"
probe /api/v1/healthz 200
probe /api/v1/readyz 200

say "step 2/5 — stopping postgres container (${PG_CONTAINER})"
docker compose stop "$PG_CONTAINER" >/dev/null
# Give the app a moment to notice the connection drop. Without this, we race
# the pool's reconnect — readyz might briefly still show ok from a cached
# connection that hasn't been tested yet.
sleep 2

say "step 3/5 — degradation probes (healthz=200, readyz=503)"
probe /api/v1/healthz 200
probe /api/v1/readyz 503

say "step 4/5 — restarting postgres"
docker compose start "$PG_CONTAINER" >/dev/null

say "step 5/5 — waiting for readyz to recover (up to ${WAIT_SECONDS}s)"
wait_for_readyz_ok

say "=== drill passed ==="
