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
# Env overrides:
#   GRAFANA_ADMIN_USER       default admin
#   GRAFANA_ADMIN_PASSWORD   default admin
#   GRAFANA_PORT             host port for Grafana (default 3000)
#   LOKI_PORT                host port for Loki    (default 3100)
# =============================================================================

set -e

# Image pins — bump deliberately. Keep in sync with obs/README.md.
LOKI_IMAGE="grafana/loki:3.2.0"
ALLOY_IMAGE="grafana/alloy:v1.4.2"
GRAFANA_IMAGE="grafana/grafana:11.2.2"

NETWORK="aziro-net"
LOKI_NAME="aziro-loki"
ALLOY_NAME="aziro-alloy"
GRAFANA_NAME="aziro-grafana"

GRAFANA_PORT="${GRAFANA_PORT:-3000}"
LOKI_PORT="${LOKI_PORT:-3100}"
GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-admin}"

# Resolve absolute path to the obs config tree (script location, not $PWD)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OBS_DIR="$SCRIPT_DIR/obs"

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
    fi

    ensure_network

    # Remove any prior containers (named volumes persist)
    docker rm -f "$LOKI_NAME" "$ALLOY_NAME" "$GRAFANA_NAME" 2>/dev/null || true

    echo "Starting Loki..."
    docker run -d --name "$LOKI_NAME" \
        --network "$NETWORK" \
        --network-alias loki \
        -p "$LOKI_PORT:3100" \
        -v "$OBS_DIR/loki/config.yml:/etc/loki/config.yml:ro" \
        -v aziro-loki-data:/loki \
        --restart unless-stopped \
        "$LOKI_IMAGE" \
        -config.file=/etc/loki/config.yml >/dev/null

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

    echo "Starting Grafana..."
    docker run -d --name "$GRAFANA_NAME" \
        --network "$NETWORK" \
        -p "$GRAFANA_PORT:3000" \
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

    echo ""
    echo "Obs stack up."
    echo "  Grafana:  http://localhost:$GRAFANA_PORT  ($GRAFANA_ADMIN_USER / $GRAFANA_ADMIN_PASSWORD)"
    echo "  Loki:     http://localhost:$LOKI_PORT"
    echo ""
    echo "App container must be on the '$NETWORK' network and labeled"
    echo "com.aziro.logs=true for Alloy to scrape it. docker-run.sh handles that."
}

cmd_down() {
    docker rm -f "$LOKI_NAME" "$ALLOY_NAME" "$GRAFANA_NAME" 2>/dev/null || true
    echo "Obs stack stopped. Named volumes kept (use 'wipe' to delete data)."
}

cmd_wipe() {
    cmd_down
    docker volume rm aziro-loki-data aziro-alloy-data aziro-grafana-data 2>/dev/null || true
    echo "Obs volumes deleted."
}

cmd_status() {
    docker ps -a \
        --filter "name=$LOKI_NAME" \
        --filter "name=$ALLOY_NAME" \
        --filter "name=$GRAFANA_NAME" \
        --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
}

cmd_logs() {
    local svc="$1"
    case "$svc" in
        loki)    docker logs -f "$LOKI_NAME" ;;
        alloy)   docker logs -f "$ALLOY_NAME" ;;
        grafana) docker logs -f "$GRAFANA_NAME" ;;
        *)       echo "usage: $0 logs {loki|alloy|grafana}"; exit 2 ;;
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
