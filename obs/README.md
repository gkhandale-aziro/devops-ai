# Aziro — Observability stack (opt-in)

Self-hosted log aggregation for Aziro Ops. No data leaves your host.

## What's here

| Service | Port | Purpose |
| --- | --- | --- |
| Loki | 3100 | Log store (filesystem chunks, 7d retention) |
| Alloy | 12345 (internal) | Tails Docker container stdout/stderr, parses the JSON envelope, ships to Loki |
| Grafana | 3000 | UI — pre-provisioned Loki datasource + starter `Aziro — Logs` dashboard |

The stack is gated behind the `obs` Compose profile. The default
`docker compose up` starts only the Aziro app; you opt in explicitly.

## Prerequisite — Docker Compose v2

The obs stack ships as Compose services. On the VM, install the plugin once:

```bash
sudo apt-get update
sudo apt-get install -y docker-compose-plugin
docker compose version   # Docker Compose version v2.x.x
```

Nothing else on the host changes — `docker-run.sh` keeps working as before.

## Start / stop

Aziro runs via `docker-run.sh` (raw `docker run`); the obs stack runs via
Compose. Alloy finds the Aziro container through the Docker socket, so
the two don't need to share a Compose project.

```bash
# On the VM — start Aziro, then obs
./docker-run.sh --rebuild                     # app (unchanged flow)
docker compose up -d loki alloy grafana       # obs (one-time; survives app rebuilds)

# Local dev only — compose brings up everything together
docker compose --profile obs up -d

# Stop obs (keep Aziro running)
docker compose stop loki alloy grafana

# Stop everything (removes obs containers but keeps volumes)
docker compose down
```

Grafana: <http://localhost:3000> (or <http://vm-sagarpoc:3000>) — default
`admin` / `admin`. Set `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`
in `.env` before first start to avoid the forced password-change prompt.

## How logs flow

```text
aziro container stdout (JSON, one obj per line)
        │  (Docker socket)
        ▼
     Alloy  ── parses JSON → labels: level, logger
        │    ── request_id → structured metadata (not a label; avoid
        │                     high-cardinality index blowup)
        ▼
      Loki  (filesystem chunks under loki-data volume)
        │
        ▼
    Grafana Explore / dashboard
```

Only containers labeled `com.aziro.logs=true` are scraped. The `aziro`
service is pre-labeled in `docker-compose.yml`. Add the label to any
other container you want ingested.

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

## Why this stack vs. SaaS?

Aziro Ops runs inside customer infrastructure and handles credentials,
SSH sessions, and cloud API output. Shipping logs off-box to a SaaS
vendor would leak that context. Loki + Alloy + Grafana gives us the
"correlate a request, grep by level, chart error rates" workflow with
zero external dependencies.

## v1.1 — Helm chart

No Helm chart ships with v1.0 (Compose-only deploy). When the chart
lands (OBS-1, v1.1), it will mirror this stack behind a single
`observability.enabled` values flag.
