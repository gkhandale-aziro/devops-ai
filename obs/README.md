# Aziro — Observability stack (opt-in)

Self-hosted log aggregation for Aziro Ops. No data leaves your host. No
Docker Compose dependency — two shell scripts (`docker-run.sh` for the
app, `obs-run.sh` for the stack) running on plain Docker.

## What's here

| Service | Port | Purpose |
| --- | --- | --- |
| Loki | 3100 | Log store (filesystem chunks, 7d retention) |
| Alloy | 12345 (internal) | Tails Docker container stdout/stderr, parses the JSON envelope, ships to Loki |
| Grafana | 3000 | UI — pre-provisioned Loki datasource + starter `Aziro — Logs` dashboard |

All three run as plain `docker run` containers on the `aziro-net` network
shared with the app. They start/stop independently of the app, so you can
enable obs on an existing deploy without bouncing Aziro.

## Requirements

Docker only. Nothing else. Works on any Linux host (including your VM)
with Docker installed — no Compose, no Helm, no k8s.

## Start / stop

```bash
# Start the app (creates aziro-net, labels the container)
./docker-run.sh --rebuild

# Start the obs stack on the same network
./obs-run.sh up

# Everything
./obs-run.sh status
docker ps --filter network=aziro-net

# Stop obs (keep app + data volumes)
./obs-run.sh down

# Destroy obs data (after down)
./obs-run.sh wipe
```

Grafana: <http://localhost:3000> (or <http://vm-sagarpoc:3000>) — default
`admin` / `admin`. Set `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`
in `.env` (or pass them in the shell) before first start to avoid the
forced password-change prompt.

## How logs flow

```text
aziro container stdout (JSON, one obj per line)
        │  (Docker socket — host-level, works across networks)
        ▼
     Alloy  ── parses JSON → labels: level, logger
        │    ── request_id → structured metadata (not a label; avoid
        │                     high-cardinality index blowup)
        ▼
      Loki  (filesystem chunks under aziro-loki-data volume)
        │
        ▼
    Grafana Explore / dashboard
```

Only containers labeled `com.aziro.logs=true` are scraped. The `aziro`
container is pre-labeled by `docker-run.sh`. Add the label (and attach
to `aziro-net`) on any other container you want ingested.

## Useful queries (Grafana → Explore → Loki)

```logql
# All aziro logs
{job="aziro"}

# Errors only
{job="aziro", level="ERROR"}

# Follow one request across services
{job="aziro"} | json | request_id="a1b2c3..."

# Rate of log lines by level
sum by (level) (rate({job="aziro"}[1m]))
```

## Retention

168h (7 days), enforced by Loki's compactor. Increase
`limits_config.retention_period` in [loki/config.yml](loki/config.yml) if
you need longer history; note that filesystem chunks grow linearly with
retention × log volume.

## Environment overrides

All defined by `obs-run.sh`:

| Var | Default | Purpose |
| --- | --- | --- |
| `GRAFANA_ADMIN_USER` | `admin` | Grafana admin username |
| `GRAFANA_ADMIN_PASSWORD` | `admin` | Grafana admin password |
| `GRAFANA_PORT` | `3000` | Host port for Grafana |
| `LOKI_PORT` | `3100` | Host port for Loki |

## Why this stack vs. SaaS?

Aziro Ops runs inside customer infrastructure and handles credentials,
SSH sessions, and cloud API output. Shipping logs off-box to a SaaS
vendor would leak that context. Loki + Alloy + Grafana gives us the
"correlate a request, grep by level, chart error rates" workflow with
zero external dependencies.

## v1.1 — Kubernetes / Helm

v1.0 covers the Docker deploy path only (VM, laptop, any Linux host with
Docker). When we ship Helm charts (OBS-1, v1.1), the same `obs/` config
tree (Loki config, Grafana provisioning, dashboards) ports over as-is —
only Alloy's source stage changes from Docker to Kubernetes.
