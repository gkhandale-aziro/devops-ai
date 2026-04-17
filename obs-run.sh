#!/usr/bin/env bash
# =============================================================================
# Aziro Ops — Observability stack launcher
# =============================================================================
# Starts Loki + Alloy + Grafana as three raw `docker run` containers on the
# `aziro-net` network (shared with the app container). No Docker Compose
# dependency — mirrors the pattern used by docker-run.sh for the app.
#
# Usage:
#   ./obs-run.sh up           # start the stack
#   ./obs-run.sh up --pull    # pull images first
#   ./obs-run.sh down         # stop and remove containers (data volumes kept)
#   ./obs-run.sh wipe         # down + delete volumes (destructive)
#   ./obs-run.sh status       # show container state
#   ./obs-run.sh logs <svc>   # tail logs for loki|alloy|grafana
#
# Env overrides (read from ./.env next to this script, or the shell — shell wins):
#   BIND_ADDR                host iface to bind (default 127.0.0.1 — localhost
#                            only; set 0.0.0.0 only for remote access + strong
#                            GRAFANA_ADMIN_PASSWORD, since Loki itself is
#                            unauthenticated and should stay behind Grafana)
#   GRAFANA_ADMIN_USER       default admin      (change before sharing access)
#   GRAFANA_ADMIN_PASSWORD   default admin      (script warns on this default)
#   GRAFANA_PORT             host port for Grafana (default 3000)
#   LOKI_PORT                host port for Loki    (default 3100)
# =============================================================================

set -e

# Image pins — bump deliberately. Keep in sync with obs/README.md.
LOKI_IMAGE="grafana/loki:3.2.0"
ALLOY_IMAGE="grafana/alloy:v1.4.2"
GRAFANA_IMAGE="grafana/grafana:11.2.2"
PROM_IMAGE="prom/prometheus:v2.55.1"

NETWORK="aziro-net"
LOKI_NAME="aziro-loki"
ALLOY_NAME="aziro-alloy"
GRAFANA_NAME="aziro-grafana"
PROM_NAME="aziro-prometheus"

# Resolve absolute path to the obs config tree (script location, not $PWD)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OBS_DIR="$SCRIPT_DIR/obs"

# Pull the 5 obs vars from ./.env if not already set in the shell. Shell
# exports win — we skip any var that's already present. We don't `source`
# the whole file: the app's .env has AZIRO_* / cloud keys that don't belong
# in this script's environment, and `source` would clobber shell overrides.
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    for _v in BIND_ADDR GRAFANA_PORT LOKI_PORT PROM_PORT GRAFANA_ADMIN_USER GRAFANA_ADMIN_PASSWORD; do
        [[ -n "${!_v+x}" ]] && continue
        _line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?${_v}=" "$SCRIPT_DIR/.env" | head -n1 || true)
        [[ -z "$_line" ]] && continue
        _raw=$(sed -E "s/^[[:space:]]*(export[[:space:]]+)?${_v}=//" <<<"$_line")
        # Quoted values keep their contents verbatim; unquoted values get any
        # inline `# comment` stripped (and trailing whitespace trimmed).
        if [[ "$_raw" =~ ^\"(.*)\"[[:space:]]*(#.*)?$ ]]; then
            _val="${BASH_REMATCH[1]}"
        elif [[ "$_raw" =~ ^\'(.*)\'[[:space:]]*(#.*)?$ ]]; then
            _val="${BASH_REMATCH[1]}"
        else
            _val="${_raw%%[[:space:]]#*}"
            _val="${_val%"${_val##*[![:space:]]}"}"
        fi
        [[ -n "$_val" ]] && export "${_v}=${_val}"
    done
    unset _v _line _raw _val
fi

# Host-binding address:
#   Default 127.0.0.1 — Loki/Grafana reachable from localhost only. Other
#   containers on aziro-net reach them via DNS regardless of this setting.
#   Set BIND_ADDR=0.0.0.0 only if you need external access (and then
#   MUST set non-default GRAFANA_ADMIN_PASSWORD — auth is on Grafana side;
#   Loki itself is unauthenticated, so prefer going through Grafana.)
BIND_ADDR="${BIND_ADDR:-127.0.0.1}"
GRAFANA_PORT="${GRAFANA_PORT:-3000}"
LOKI_PORT="${LOKI_PORT:-3100}"
PROM_PORT="${PROM_PORT:-9090}"
GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-admin}"

ensure_network() {
    if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
        echo "Creating network $NETWORK..."
        docker network create "$NETWORK" >/dev/null
    fi
}

cmd_up() {
    local pull=0
    for arg in "$@"; do
        [[ "$arg" == "--pull" ]] && pull=1
    done

    if [[ $pull -eq 1 ]]; then
        echo "Pulling images..."
        docker pull "$LOKI_IMAGE"
        docker pull "$ALLOY_IMAGE"
        docker pull "$GRAFANA_IMAGE"
        docker pull "$PROM_IMAGE"
    fi

    # Fail-closed on remote bind with default credentials. Localhost-only
    # bind is fine with admin/admin (dev laptop scenario); exposing the
    # stack externally with the default password is the actual footgun.
    if [[ "$BIND_ADDR" != "127.0.0.1" ]] && [[ "$GRAFANA_ADMIN_PASSWORD" == "admin" ]]; then
        echo "ERROR: BIND_ADDR=$BIND_ADDR exposes Grafana externally, but"
        echo "       GRAFANA_ADMIN_PASSWORD is still the default 'admin'."
        echo ""
        echo "       Set a strong password in .env or the shell before retrying:"
        echo "         export GRAFANA_ADMIN_PASSWORD='<something-strong>'"
        echo "         ./obs-run.sh up"
        echo ""
        echo "       (Localhost-only is safer — leave BIND_ADDR unset and use"
        echo "        'ssh -L 3000:127.0.0.1:3000 <host>' to reach Grafana.)"
        exit 1
    fi

    ensure_network

    # Remove any prior containers (named volumes persist)
    docker rm -f "$LOKI_NAME" "$ALLOY_NAME" "$GRAFANA_NAME" "$PROM_NAME" 2>/dev/null || true

    # Rollback: if any of the three `docker run` commands below fail, tear
    # down anything we already started so the host isn't left half-up.
    local started=()
    _cleanup() {
        [[ ${#started[@]} -gt 0 ]] && docker rm -f "${started[@]}" >/dev/null 2>&1 || true
    }
    trap _cleanup ERR

    echo "Starting Loki (bound to ${BIND_ADDR}:${LOKI_PORT})..."
    docker run -d --name "$LOKI_NAME" \
        --network "$NETWORK" \
        --network-alias loki \
        -p "${BIND_ADDR}:${LOKI_PORT}:3100" \
        -v "$OBS_DIR/loki/config.yml:/etc/loki/config.yml:ro" \
        -v aziro-loki-data:/loki \
        --restart unless-stopped \
        "$LOKI_IMAGE" \
        -config.file=/etc/loki/config.yml >/dev/null
    started+=("$LOKI_NAME")

    echo "Starting Alloy..."
    docker run -d --name "$ALLOY_NAME" \
        --network "$NETWORK" \
        -v "$OBS_DIR/alloy/config.alloy:/etc/alloy/config.alloy:ro" \
        -v /var/run/docker.sock:/var/run/docker.sock:ro \
        -v aziro-alloy-data:/var/lib/alloy/data \
        --restart unless-stopped \
        "$ALLOY_IMAGE" \
        run \
        --server.http.listen-addr=0.0.0.0:12345 \
        --storage.path=/var/lib/alloy/data \
        /etc/alloy/config.alloy >/dev/null
    started+=("$ALLOY_NAME")

    # Prometheus has no auth and exposes /-/reload (lifecycle). Grafana
    # reaches it over docker DNS (`http://prometheus:9090`), so we don't
    # need the host port for the normal UI flow. Default to localhost-only
    # regardless of $BIND_ADDR; set PROM_EXPOSE=1 to publish externally
    # (debugging only — put a reverse-proxy + auth in front before doing so).
    local prom_bind="127.0.0.1"
    if [[ "${PROM_EXPOSE:-0}" == "1" ]]; then
        prom_bind="$BIND_ADDR"
        echo "WARNING: PROM_EXPOSE=1 — publishing Prometheus on ${prom_bind}:${PROM_PORT}"
        echo "         (no auth; /-/reload is reachable. Add a reverse proxy before production use.)"
    fi
    echo "Starting Prometheus (bound to ${prom_bind}:${PROM_PORT})..."
    docker run -d --name "$PROM_NAME" \
        --network "$NETWORK" \
        --network-alias prometheus \
        -p "${prom_bind}:${PROM_PORT}:9090" \
        -v "$OBS_DIR/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro" \
        -v aziro-prometheus-data:/prometheus \
        --restart unless-stopped \
        "$PROM_IMAGE" \
        --config.file=/etc/prometheus/prometheus.yml \
        --storage.tsdb.retention.time=15d \
        --web.enable-lifecycle >/dev/null
    started+=("$PROM_NAME")

    echo "Starting Grafana (bound to ${BIND_ADDR}:${GRAFANA_PORT})..."
    docker run -d --name "$GRAFANA_NAME" \
        --network "$NETWORK" \
        -p "${BIND_ADDR}:${GRAFANA_PORT}:3000" \
        -e "GF_SECURITY_ADMIN_USER=$GRAFANA_ADMIN_USER" \
        -e "GF_SECURITY_ADMIN_PASSWORD=$GRAFANA_ADMIN_PASSWORD" \
        -e "GF_AUTH_ANONYMOUS_ENABLED=false" \
        -e "GF_ANALYTICS_REPORTING_ENABLED=false" \
        -e "GF_ANALYTICS_CHECK_FOR_UPDATES=false" \
        -v "$OBS_DIR/grafana/provisioning:/etc/grafana/provisioning:ro" \
        -v "$OBS_DIR/grafana/dashboards:/var/lib/grafana/dashboards:ro" \
        -v aziro-grafana-data:/var/lib/grafana \
        --restart unless-stopped \
        "$GRAFANA_IMAGE" >/dev/null
    started+=("$GRAFANA_NAME")

    trap - ERR

    echo ""
    echo "Obs stack up."
    echo "  Grafana:     http://${BIND_ADDR}:${GRAFANA_PORT}  (user: ${GRAFANA_ADMIN_USER})"
    echo "  Loki:        http://${BIND_ADDR}:${LOKI_PORT}"
    echo "  Prometheus:  http://${prom_bind}:${PROM_PORT}"
    echo ""

    if [[ "$GRAFANA_ADMIN_PASSWORD" == "admin" ]]; then
        echo "  WARNING: Grafana admin password is the default ('admin')."
        echo "           Set GRAFANA_ADMIN_PASSWORD in .env or the shell"
        echo "           before first start — Grafana will prompt to reset"
        echo "           otherwise. Do NOT leave this on a shared/VM host."
        echo ""
    fi

    echo "App container must be on the '$NETWORK' network and labeled"
    echo "com.aziro.logs=true for Alloy to scrape it. docker-run.sh handles that."
    echo ""
    echo "Prometheus scrapes http://aziro:5000/metrics (in-network DNS)."
    echo "If the app binds only localhost, the scrape still works — both"
    echo "containers share '$NETWORK'."
}

cmd_down() {
    docker rm -f "$LOKI_NAME" "$ALLOY_NAME" "$GRAFANA_NAME" "$PROM_NAME" 2>/dev/null || true
    echo "Obs stack stopped. Named volumes kept (use 'wipe' to delete data)."
}

cmd_wipe() {
    cmd_down
    docker volume rm aziro-loki-data aziro-alloy-data aziro-grafana-data aziro-prometheus-data 2>/dev/null || true
    echo "Obs volumes deleted."
}

cmd_status() {
    docker ps -a \
        --filter "name=$LOKI_NAME" \
        --filter "name=$ALLOY_NAME" \
        --filter "name=$GRAFANA_NAME" \
        --filter "name=$PROM_NAME" \
        --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
}

cmd_logs() {
    local svc="$1"
    case "$svc" in
        loki)       docker logs -f "$LOKI_NAME" ;;
        alloy)      docker logs -f "$ALLOY_NAME" ;;
        grafana)    docker logs -f "$GRAFANA_NAME" ;;
        prometheus) docker logs -f "$PROM_NAME" ;;
        *)          echo "usage: $0 logs {loki|alloy|grafana|prometheus}"; exit 2 ;;
    esac
}

case "${1:-}" in
    up)     shift; cmd_up "$@" ;;
    down)   cmd_down ;;
    wipe)   cmd_wipe ;;
    status) cmd_status ;;
    logs)   shift; cmd_logs "$@" ;;
    *)
        echo "Aziro Ops — observability stack (Loki + Alloy + Grafana)"
        echo ""
        echo "Usage: $0 {up|down|wipe|status|logs <svc>}"
        echo ""
        echo "  up [--pull]   start the stack (pull images first if --pull)"
        echo "  down          stop containers (volumes kept)"
        echo "  wipe          stop + delete volumes (destructive)"
        echo "  status        show container state"
        echo "  logs <svc>    tail logs for loki|alloy|grafana"
        exit 2
        ;;
esac
