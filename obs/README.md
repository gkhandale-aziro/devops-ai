# Aziro — Observability stack (opt-in)

Self-hosted log aggregation for Aziro Ops. No data leaves your host. No
Docker Compose dependency — two shell scripts (`docker-run.sh` for the
app, `obs-run.sh` for the stack) running on plain Docker.

## What's here

| Service | Port | Purpose |
| --- | --- | --- |
| Loki | 3100 | Log store (filesystem chunks, 7d retention) |
| Alloy | 12345 (internal) | Tails Docker container stdout/stderr, parses the JSON envelope, ships to Loki |
| Prometheus | 9090 | Scrapes `aziro:5000/metrics`, 15d retention |
| Grafana | 3000 | UI — pre-provisioned Loki + Prometheus datasources, starter `Aziro — Logs` and `Aziro — Metrics` dashboards |

All four run as plain `docker run` containers on the `aziro-net` network
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

## Metrics (RUN-3)

Prometheus scrapes the app's `/metrics` endpoint every 15s via in-network
DNS (`aziro:5000`). Metrics surface through the pre-provisioned
`Aziro — Metrics` dashboard in Grafana.

```text
aziro /metrics ── prometheus_client text format ─→ Prometheus ─→ Grafana
                                                       │
                                                       └── 15d retention
```

What's measured (label schemas are locked — see
[observability/metrics.py](../observability/metrics.py)):

- `aziro_http_requests_total{method,route,status}` — paths are normalized
  (`/api/v1/targets/42` → `/api/v1/targets/:id`) so IDs don't blow up
  cardinality
- `aziro_http_request_duration_seconds_bucket{method,route}` — p50/p95/p99
- `aziro_llm_calls_total{model,outcome}` — `outcome`: ok|quota|timeout|error
- `aziro_llm_tokens_total{model,direction}` — prompt/completion/total
- `aziro_llm_fallback_total{from_model,to_model,reason}` — quota-driven
  primary→Ollama switches
- `aziro_tool_calls_total{tool,outcome}` — agent tool dispatch

### Useful PromQL queries

```promql
# Request rate by route
sum by (route) (rate(aziro_http_requests_total[5m]))

# p95 latency by route
histogram_quantile(0.95, sum by (route, le) (rate(aziro_http_request_duration_seconds_bucket[5m])))

# LLM fallback count over the last hour
sum(increase(aziro_llm_fallback_total[1h]))

# Tokens/sec by model
sum by (model) (rate(aziro_llm_tokens_total[5m]))
```

### Auth for /metrics

By default `/metrics` is open — Prometheus scrapes over the private
`aziro-net` docker bridge, and the endpoint isn't exposed on the host.
To lock it down, set `AZIRO_METRICS_TOKEN` on the app and add a matching
`authorization: { type: Bearer, credentials_file: ... }` block to
[prometheus/prometheus.yml](prometheus/prometheus.yml).

### Multi-process mode

`docker-run.sh` sets `PROMETHEUS_MULTIPROC_DIR=/tmp/prometheus_multiproc`
so gunicorn workers write per-process metric shards and `/metrics`
aggregates them on each scrape. Without this, scraping a random worker
would return 1/N of reality.

## Retention

- Loki: 168h (7 days), enforced by the compactor. Increase
  `limits_config.retention_period` in [loki/config.yml](loki/config.yml)
  if you need longer history.
- Prometheus: 15 days, set via `--storage.tsdb.retention.time=15d` in
  `obs-run.sh`. Chunks grow linearly with retention × time-series count.

## Environment overrides

All defined by `obs-run.sh`:

| Var | Default | Purpose |
| --- | --- | --- |
| `GRAFANA_ADMIN_USER` | `admin` | Grafana admin username |
| `GRAFANA_ADMIN_PASSWORD` | `admin` | Grafana admin password |
| `GRAFANA_PORT` | `3000` | Host port for Grafana |
| `LOKI_PORT` | `3100` | Host port for Loki |
| `PROM_PORT` | `9090` | Host port for Prometheus |
| `BIND_ADDR` | `127.0.0.1` | Interface the host ports bind to |

And on the app side (`docker-run.sh`):

| Var | Default | Purpose |
| --- | --- | --- |
| `AZIRO_METRICS_TOKEN` | unset (open) | Bearer token required on `/metrics` |
| `PROMETHEUS_MULTIPROC_DIR` | `/tmp/prometheus_multiproc` | Per-worker metric shard dir |

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
