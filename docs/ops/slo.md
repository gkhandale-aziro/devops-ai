# Aziro Ops — SLOs (v1.0)

Service-level objectives for a **single-host docker-compose** deployment. The numbers below are the contract v1.0 commits to — post-v1.0 (multi-node, Helm) will tighten availability but loosen recovery time.

These are **not** aspirational — every SLO below has a probe or a script that measures it, and a runbook for what to do when it breaches.

---

## SLO table

| ID       | SLO                                    | Target                          | Measured by                                                               | Window  |
|----------|----------------------------------------|---------------------------------|---------------------------------------------------------------------------|---------|
| AVAIL-1  | Liveness (`/api/v1/healthz`)           | ≥ 99.5 % HTTP 200               | Prometheus blackbox probe / curl loop                                     | 30 d    |
| AVAIL-2  | Readiness (`/api/v1/readyz`) — PG up   | ≥ 99.0 % HTTP 200               | Prometheus blackbox probe                                                 | 30 d    |
| LAT-1    | `GET /api/v1/events` p95               | ≤ 400 ms                        | gunicorn access log (continuous) + `ops/loadtest/smoke.js` (release gate) | 7 d     |
| LAT-2    | `GET /api/v1/events` p99               | ≤ 1.0 s                         | gunicorn access log                                                       | 7 d     |
| LAT-3    | AI triage answer (SEV2 enrichment)     | ≤ 20 s p95                      | `monitor/triage.py` log timestamps                                        | 7 d     |
| RECO-1   | Readyz recovery after PG restart       | ≤ 30 s                          | `ops/chaos/kill-postgres.sh`                                              | per run |
| RECO-2   | Liveness stays green during PG outage  | 100 %                           | `ops/chaos/kill-postgres.sh`                                              | per run |
| BAK-1    | Backup freshness                       | last object ≤ 26 h old in MinIO | `scripts/check_backup_freshness.py` (nightly)                             | daily   |
| BAK-2    | Nightly restore-verify passes          | ≥ 29 of last 30 runs            | Loki `aziro-restore-verify` label                                         | 30 d    |
| DATA-1   | Audit-log write durability             | 100 % — no dropped events       | `events` row count vs `audit_log` row count                               | —       |

---

## Why these numbers

### AVAIL-1 / AVAIL-2 — 99.5 % vs 99.0 %

Liveness has a higher target than readiness **on purpose**. The whole point of the split is that we can lose Postgres for five minutes without k8s (or a human) restarting the whole app — readiness flips to 503, traffic drains, PG comes back, readiness flips green. Liveness never flinches.

99.5 % over 30 days = ~3.6 h of allowed downtime. On a single-host deploy with planned restarts (OS patching, docker upgrades, PG version bumps), that's the honest ceiling. Tighter targets require HA, which is post-v1.0.

99.0 % readiness = ~7.2 h. The extra budget covers planned DB restarts and the ~10 s readyz-probe latency when PG is cold.

### LAT-1 — 400 ms p95 on `/api/v1/events`

The dashboard polls this every 5 s. >400 ms at p95 makes the UI feel laggy; the table blinks as rows repaint. Measured on a VM with ~10 k events in `events` table.

Deeper endpoints (`GET /api/v1/events/<id>/history`, `POST /api/v1/triage/:id/explain`) have no hard target in v1.0 — they're behind user actions, not auto-refresh.

### LAT-3 — 20 s p95 for AI triage

The LLM call dominates. Gemini Flash / GPT-4o-mini round-trip is 3–15 s depending on context size; we cap context at ~8 k tokens. If this breaches, the fix is usually upstream (provider latency) or context bloat (too many history events in the prompt).

### RECO-1 — 30 s readyz recovery

The chaos drill (`ops/chaos/kill-postgres.sh`) waits up to `WAIT_SECONDS=30`. PG cold start is ~5–8 s; readyz probe is ≤1 s; docker restart adds ~2 s. 30 s leaves room for a slow VM without hiding a real regression.

### BAK-1 — 26 h freshness

Backups run nightly at 02:00 via ofelia. 26 h = 24 h + 2 h slack for a late run. Anything older than 26 h means last night's backup didn't complete, which is a SEV2.

### BAK-2 — 29/30 restore-verify passes

Restore-verify runs nightly immediately after `backup.sh`. One miss per month is acceptable (transient MinIO timeout, ofelia skew). Two consecutive misses is a SEV1.

---

## How each SLO is measured

### AVAIL-1 / AVAIL-2 — Prometheus blackbox

```yaml
- job_name: aziro-healthz
  metrics_path: /probe
  params: { module: [http_2xx] }
  static_configs:
    - targets: ['https://aziro.example.com/api/v1/healthz']
  relabel_configs:
    - source_labels: [__address__]
      target_label: __param_target
```

Alert rule:

```yaml
- alert: AziroLivenessBreached
  expr: avg_over_time(probe_success{job="aziro-healthz"}[30d]) < 0.995
  for: 10m
```

### LAT-1 / LAT-2 — gunicorn access log → Loki

gunicorn logs every request with response time. Loki query:

```logql
quantile_over_time(0.95,
  {service="aziro"} |= "GET /api/v1/events"
    | pattern `<_> <_> <_> <status> <_> <dur_us>`
    | unwrap dur_us [7d]
) / 1000
```

Divide by 1000 for ms. Alert: breach if p95 > 400 for 1 h.

### RECO-1 / RECO-2 — chaos drill

```bash
./ops/chaos/kill-postgres.sh
```

Pass output includes `drill passed in Ns`. If N > 30, SLO breached. See [chaos-drills.md](./chaos-drills.md).

### BAK-1 — freshness probe

Ofelia runs a nightly `check-backup-freshness` job (post-v1.0 — for v1.0, check manually):

```bash
docker compose exec backup sh -c \
  'mc find aziro/aziro-backups --newer-than 26h | head -1'
```

Empty output = SLO breached.

### BAK-2 — Loki query

```logql
count_over_time(
  {job="docker"} | json | component="aziro-restore-verify" |= "restore-verify complete" [30d]
)
```

(The JSON envelope from `ops/backup/restore-verify.sh` uses `component` as the service label — not `com_aziro_service` — and its final success line is `restore-verify complete`, not `verify ok`.)

≥29 = pass.

---

## Error budget

Monthly budget (30-day window):

| SLO     | Target  | Budget (minutes / month) |
|---------|---------|--------------------------|
| AVAIL-1 | 99.5 %  | 216 min                  |
| AVAIL-2 | 99.0 %  | 432 min                  |
| BAK-2   | ≥29/30  | 1 missed run             |

**Rule:** if the budget for an SLO is >50 % consumed halfway through the window, feature work on that subsystem stops until the trend recovers.

---

## What's explicitly **not** an SLO in v1.0

These will get SLOs post-v1.0 but don't in v1.0 because we don't have the scaffolding to measure them reliably yet:

- **LLM provider uptime** — third-party, out of our control; monitor via provider's status page
- **k8s watcher lag** — no `last_event_ingested_at` metric exported yet
- **SSE connection liveness** — no client-side probe
- **Login latency** — argon2 rehash path varies ~50×; not a stable metric
- **Session-store availability** — Redis single-instance; implicit in AVAIL-2

---

## Breach response

Each SLO breach maps to exactly one action:

| SLO breached | First action                                                    | Runbook                                          |
|--------------|-----------------------------------------------------------------|--------------------------------------------------|
| AVAIL-1      | Check `docker compose ps` — is `aziro` healthy?                 | [deploy-guide.md](./deploy-guide.md) → §Troubleshooting |
| AVAIL-2      | `docker compose logs postgres` — is PG up?                      | [deploy-guide.md](./deploy-guide.md) → §Troubleshooting |
| LAT-1 / 2    | Check `events` row count; run `ANALYZE events;`                 | Post-v1.0 — profile endpoint                     |
| LAT-3        | Check provider status page; trim triage context size            | `monitor/triage.py` → `_build_context()`         |
| RECO-1       | Run `./ops/chaos/kill-postgres.sh` manually, capture output     | [chaos-drills.md](./chaos-drills.md)             |
| BAK-1        | `./ops/chaos/run-backup-drill.sh` to force a backup             | [backup-restore.md](./backup-restore.md)         |
| BAK-2        | Inspect last night's Loki logs for `aziro-restore-verify`       | [backup-restore.md](./backup-restore.md)         |
| DATA-1       | **SEV1** — stop writes, compare row counts, investigate         | Post-v1.0 — DR runbook                           |

---

## See also

- [deploy-guide.md](./deploy-guide.md) — from-scratch deploy
- [backup-restore.md](./backup-restore.md) — backup operations
- [chaos-drills.md](./chaos-drills.md) — recovery drills
- [v1.0-checklist.md](./v1.0-checklist.md) — VM walkthrough before tagging
