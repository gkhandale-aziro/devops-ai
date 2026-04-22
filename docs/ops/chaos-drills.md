# Chaos Drills Runbook (REL-1)

## Scope

Two on-demand drills that verify Aziro Ops behaves correctly when the Postgres backing store is lost or corrupted. Both are intended to be run manually pre-release, pre-demo, or after any infrastructure change that touches the DB/backup path. They do **not** run on a schedule — the nightly `restore-verify.sh` already does that; these drills are for humans-in-the-loop.

- **kill-postgres** — proves the app degrades gracefully when PG is down (LB probe contract)
- **run-backup-drill** — proves the DB-4 backup + restore pipeline works end-to-end, on demand

Both drills live in [`ops/chaos/`](../../ops/chaos/).

---

## Drill 1 — kill-postgres

### What it asserts

| Endpoint | State | Expected |
|---|---|---|
| `GET /api/v1/healthz` | PG up | `200 {"status":"ok"}` |
| `GET /api/v1/readyz` | PG up | `200 {"status":"ok","checks":{"postgresql":"ok", …}}` |
| `GET /api/v1/healthz` | PG down | `200 {"status":"ok"}` (liveness must not depend on PG) |
| `GET /api/v1/readyz` | PG down | `503 {"status":"unavailable","checks":{"postgresql":"fail: …"}}` |
| `GET /api/v1/readyz` | PG back up | `200` within 30s |

This is the contract every LB / k8s readiness probe already relies on. The drill codifies it.

### What it deliberately does NOT assert

Individual `/api/*` endpoints that hit the store will 500 under PG-down. That's a separate app-hardening story — REL-1 verifies the **probe contract**, which is what keeps traffic off a broken instance. Making every endpoint return 503 gracefully is a different ticket.

### Run it

```bash
# From repo root, with the compose stack up (aziro + postgres both running):
./ops/chaos/kill-postgres.sh
```

Pass looks like:
```
[chaos] === REL-1 chaos drill: kill-postgres ===
[chaos] step 1/5 — baseline probes (both should be 200)
[chaos]   /api/v1/healthz → 200 (expected 200) ✓
[chaos]   /api/v1/readyz → 200 (expected 200) ✓
[chaos] step 2/5 — stopping postgres container (postgres)
[chaos] step 3/5 — degradation probes (healthz=200, readyz=503)
[chaos]   /api/v1/healthz → 200 (expected 200) ✓
[chaos]   /api/v1/readyz → 503 (expected 503) ✓
[chaos] step 4/5 — restarting postgres
[chaos] step 5/5 — waiting for readyz to recover (up to 30s)
[chaos]   readyz recovered after 4s
[chaos] === drill passed ===
```

### Env overrides

| Var | Default | When to set |
|---|---|---|
| `AZIRO_URL` | `http://localhost:5000` | Running inside the compose network (`http://aziro:5000`) |
| `PG_CONTAINER` | `postgres` | Custom compose project/service name |
| `WAIT_SECONDS` | `30` | Slow CI box that takes longer to recover PG |

### Safety

A `trap cleanup EXIT INT TERM` restarts postgres on any abort — Ctrl-C mid-drill will not leave the stack in a degraded state. If the drill itself exits 0, cleanup is a no-op (PG is already up from step 4).

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| `readyz → 200` in step 3 | App is using a stale pooled connection — wait 5s or increase the `sleep 2` in the script |
| `readyz never recovered` | Postgres crash on restart; check `docker compose logs postgres` |
| `curl: (7) Failed to connect` | `AZIRO_URL` wrong, or aziro container down |

---

## Drill 2 — run-backup-drill

### What it asserts

1. `mc ls` object count in `aziro-backups` bucket increments after `backup.sh` runs
2. `backup.sh` exits 0 (pg_dump + mc cp both succeeded)
3. `restore-verify.sh` exits 0 (pg_restore + schema diff + row count all passed)

This is a manual trigger of the same two scripts that run on Ofelia at 02:00 / 02:30 UTC. Use it to verify the pipeline works **now** — before a release, after a credentials rotation, or after changing the Postgres or MinIO version.

### Run it

```bash
# From repo root, with the full compose stack up (aziro + postgres + minio + backup):
./ops/chaos/run-backup-drill.sh
```

Pass looks like:
```
[drill] === REL-1 chaos drill: run-backup-drill ===
[drill] step 1/4 — snapshot MinIO object count before backup
[drill]   objects before: 3
[drill] step 2/4 — triggering backup.sh
[drill]   backup.sh completed in 2s
[drill] step 3/4 — verifying object count incremented
[drill]   objects after: 4
[drill]   ✓ object count increased by 1
[drill] step 4/4 — triggering restore-verify.sh
[drill]   restore-verify.sh completed in 3s
[drill] === drill passed ===
```

### Side effects

The drill writes a real dump to the real `aziro-backups` bucket. Running it repeatedly during a demo day will eat retention budget — but MinIO's lifecycle rule expires dumps after 30 days (default) so it self-cleans. If you run dozens of drills in one day, expect some retention churn, not data loss.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `mc alias set failed` | Wrong `MINIO_ROOT_USER`/`PASSWORD` in `.env` | Rotate credentials (see `docs/ops/backup-restore.md#credential-rotation`) |
| `pg_dump: error: connection …` | `AZIRO_DB_URL` wrong inside the backup container | Check `docker compose config backup` |
| Object count didn't increase | `backup.sh` exited 0 without writing — very unlikely (it has `set -eu`). Check `docker compose logs backup` | File a bug |
| `restore-verify` fails on row count | Live DB row count dropped between dump and verify — rare but possible if a delete ran in that 30-min window | Re-run; if persistent, investigate the deletion path |

---

## Loki queries

Both drills run the existing `backup.sh` / `restore-verify.sh` scripts inside the backup sidecar, so their logs show up under the same labels as the nightly job:

```logql
{com_aziro_service="backup"} | json | component="aziro-backup"
{com_aziro_service="backup"} | json | component="aziro-restore-verify"
```

To filter to a drill run (vs the nightly cron), narrow by timestamp — there's no drill-specific label today.

---

## Demo script — Thursday 2026-04-23

For the v1.0 demo, the DB-4 narrative walks through both drills:

1. `./ops/chaos/run-backup-drill.sh` — "here's the backup pipeline working on demand"
2. `./ops/chaos/kill-postgres.sh` — "and here's what happens when PG actually dies: the LB takes us out of rotation cleanly, nothing crashes, we come back when PG comes back"

Total runtime: ~1 min for drill 2, ~45s for drill 1. Both fit in a single terminal pane.

---

## See also

- [Backup & Restore Runbook](./backup-restore.md) — DB-4 backup pipeline, credential rotation, manual disaster recovery
- [`ops/chaos/`](../../ops/chaos/) — drill scripts
- [`docker-compose.yml`](../../docker-compose.yml) — compose wiring
