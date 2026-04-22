# Aziro Ops — Load Test Runbook

k6 smoke that gates v1.0 exit criterion: *"`/healthz`, `/readyz`, `/metrics` green under k6 load test."*

Scope: **smoke**, not capacity planning. 50 VUs × 5 min on a single-host compose stack. Full capacity modeling is post-v1.0.

---

## What it proves

The smoke verifies five things in one run:

1. **Liveness never regresses under load.** `/api/v1/healthz` must return 200 on every probe — failing this means k8s (or a human) would restart the app under what should be a non-event.
2. **Readiness degrades gracefully but stays mostly green.** `/api/v1/readyz` must be ≥ 99 % 200 (matches [slo.md AVAIL-2](../../docs/ops/slo.md)).
3. **`/metrics` stays scrapeable.** If Prometheus can't scrape under load, the whole observability story collapses exactly when you need it most.
4. **`/api/v1/events` p95 stays under 400 ms** (matches [slo.md LAT-1](../../docs/ops/slo.md)).
5. **10 concurrent SSE streams stay open.** This is what the UI actually does — without this, "50 users" doesn't mean 50 dashboards.

If any threshold breaches, k6 exits non-zero. No soft warnings.

---

## Running

### Against localhost (compose stack on your laptop)

```bash
# One-shot, no auth (hits only unauth endpoints):
k6 run ops/loadtest/smoke.js

# With auth (hits /api/v1/events too):
export AZIRO_API_KEY=$(grep ^AZIRO_API_KEY .env | cut -d= -f2)
k6 run ops/loadtest/smoke.js
```

### Against a VM

```bash
AZIRO_URL=http://vm-sagarpoc:5000 \
AZIRO_API_KEY=... \
  k6 run ops/loadtest/smoke.js
```

### Via docker (no local k6 install)

```bash
docker run --rm -i \
  --network host \
  -e AZIRO_URL=http://localhost:5000 \
  -e AZIRO_API_KEY="$AZIRO_API_KEY" \
  -v "$PWD/ops/loadtest:/scripts" \
  grafana/k6:latest run /scripts/smoke.js
```

> On macOS / Windows Docker Desktop, `--network host` doesn't work — substitute `AZIRO_URL=http://host.docker.internal:5000` instead.

---

## Reading the output

Pass output ends with:

```text
✓ checks.........................: 100.00% ✓ 45123 ✗ 0
✓ healthz_200_rate...............: 100.00%
✓ readyz_200_rate................: 99.8%
✓ metrics_200_rate...............: 100.00%
✓ http_req_duration{name:events} : p(95)=267.12ms
✓ http_req_failed{scenario:probes}: 0.04%
```

If k6 exits non-zero, the summary has the failing threshold in red. The two failure shapes to recognize:

| Symptom | Likely cause | Where to look |
|---------|--------------|---------------|
| `healthz_200_rate < 0.999` | App process is unhealthy — OOM, gunicorn crash loop | `docker compose logs aziro` |
| `readyz_200_rate < 0.99` | DB connection pool exhausted | `docker compose logs postgres`; check `max_connections` |
| `http_req_duration{name:events}` p95 > 400 ms | DB not analyzed, or events table fragmented | `docker compose exec postgres psql -U aziro -c 'ANALYZE events;'` |
| `metrics_200_rate < 0.999` | Multiprocess Prom collector contention | `observability/metrics.py`; verify `PROMETHEUS_MULTIPROC_DIR` env |
| `sse_held_rate < 1` (aka "sse held ≥90%" check) | gunicorn timeout too short or worker class wrong | `gunicorn.conf.py` — must be gevent with `--timeout 0` on SSE path |
| `http_req_failed{scenario:probes}` rate ≥ 0.01 | Server is returning 5xx under load — LLM fan-out, DB pool exhaust, rate-limiter misconfig | `docker compose logs aziro`; inspect error distribution by endpoint tag |
| `events_200_rate < 0.99` (only when `AZIRO_API_KEY` set) | Auth middleware regression, or rate-limit cap hit by the smoke itself | `docker compose logs aziro` for 401/429; check `AZIRO_RATELIMIT_*` in .env |

---

## Tuning

The defaults are chosen for a single-host VM with ≥4 GB RAM. If your target is weaker, override:

| Env var           | Default | Notes                                              |
|-------------------|---------|----------------------------------------------------|
| `AZIRO_URL`       | `http://localhost:5000` | Target base URL                     |
| `AZIRO_API_KEY`   | *(unset)* | Omits the /events probe when unset             |
| `SSE_HOLD_SECONDS`| `300`   | How long each SSE VU holds its connection         |

**Don't tune the VU count or stage durations.** The thresholds in `smoke.js` are calibrated to `50 VUs × 5 min`. If you change VUs, the p95 target is meaningless as a regression signal — you'd need to re-baseline.

---

## When to run it

- **Before tagging any release** — as part of the [v1.0 checklist §8](../../docs/ops/v1.0-checklist.md).
- **After any change to** `ui/web.py`, `gunicorn.conf.py`, `observability/metrics.py`, `store/db.py`.
- **Never in CI against prod.** The stack doesn't have a staging tier yet; run against a VM replica or your laptop.

---

## See also

- [docs/ops/slo.md](../../docs/ops/slo.md) — the SLO targets the thresholds mirror
- [docs/ops/v1.0-checklist.md](../../docs/ops/v1.0-checklist.md) §8 — where this smoke plugs into the release gate
- [docs/ops/chaos-drills.md](../../docs/ops/chaos-drills.md) — the other half of the "under load" story (degradation, not steady-state)
