# Aziro Ops — Deploy Guide (v1.0)

A step-by-step runbook for standing up Aziro Ops on a fresh VM. Every command is copy-pasteable. The "Verify" boxes between steps let you stop and confirm before moving on — if one fails, don't proceed until it passes.

## Scope

This guide covers a **single-host docker-compose** deployment — the shape shipped with v1.0. Multi-node, Helm, and cloud-managed variants are post-v1.0 (see [`TODO.md`](../../TODO.md) → "Phase 2" and "Deferred infra").

Everything below assumes:
- A Linux VM (Debian 12 / Ubuntu 22.04 / RHEL 9 class) with Docker + docker compose plugin
- Root shell or a user in the `docker` group
- Outbound HTTPS to one LLM provider (Gemini, OpenAI, Anthropic, or a self-hosted Ollama)
- At least 4 GB RAM, 20 GB disk

---

## Architecture

Six containers, one docker-compose project:

```
 ┌────────────────┐
 │  aziro         │  Flask + gunicorn + gevent. :5000
 │  (app)         │  UI, API, SSE, agent loop, k8s watcher
 └────────────────┘
         │
         ├──▶ postgres    Durable state (events, users, audit_log, …)
         ├──▶ redis       Rate-limit counters, sessions, SSE pub/sub
         └──▶ minio       Backup target (via backup sidecar)
                    │
         ┌──────────┴──────────┐
         │  backup             │  pg_dump → MinIO (nightly)
         │  (ofelia-driven)    │  restore-verify (nightly)
         └─────────────────────┘
                    ▲
                    │
         ┌──────────────────────┐
         │  ofelia              │  cron daemon — triggers backup + drill
         └──────────────────────┘
```

Optional observability stack (separate `./obs-run.sh` — not in docker-compose.yml):
- **Loki + Alloy** for log aggregation
- **Prometheus** for metrics scrape
- **Grafana** for dashboards

---

## Step 1 — Clone and prepare the host

```bash
# One-time host prep
sudo apt-get update && sudo apt-get install -y git ca-certificates curl

# Install Docker if not present
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# Log out + back in, or run: newgrp docker

# Clone
git clone https://github.com/gkhandale-aziro/devops-ai.git /opt/aziro
cd /opt/aziro
git checkout main   # v1.0 lives here after REL-2
```

**Verify:**
```bash
docker --version                   # expect 24.x+
docker compose version             # expect v2.x+
ls docker-compose.yml .env.example # both must exist
```

---

## Step 2 — Create `.env` with the required secrets

Three secrets are **required** before the first `docker compose up`. The rest have safe defaults.

```bash
cp .env.example .env

# Generate three independent tokens
POSTGRES_PASSWORD=$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')
AZIRO_SESSION_SECRET=$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')
MINIO_ROOT_PASSWORD=$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')

# Write them in-place (uncomments the example lines + fills values)
sed -i \
  -e "s|^# POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" \
  -e "s|^# AZIRO_SESSION_SECRET=.*|AZIRO_SESSION_SECRET=${AZIRO_SESSION_SECRET}|" \
  -e "s|^# MINIO_ROOT_USER=.*|MINIO_ROOT_USER=aziro-admin|" \
  -e "s|^# MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}|" \
  .env

chmod 600 .env
```

**Do NOT** yet set `AZIRO_DB_URL` — the first boot uses SQLite, and we migrate to Postgres in Step 5.

### Set your LLM credential

Pick one (Gemini is the default for v1.0 — fast, cheap, auto-falls-back to Ollama on quota):

```bash
# Option A — Gemini (recommended)
echo 'AI_MODEL=gemini/gemini-2.5-flash' >> .env
echo 'GEMINI_API_KEY=<your-key>' >> .env

# Option B — OpenAI
# echo 'AI_MODEL=gpt-4o-mini' >> .env
# echo 'OPENAI_API_KEY=sk-...' >> .env

# Option C — Local Ollama only (no API key needed)
# echo 'AI_MODEL=ollama/qwen2.5:7b' >> .env
# echo 'OLLAMA_API_BASE=http://host.docker.internal:11434' >> .env
```

### Set the bootstrap admin

```bash
AZIRO_BOOTSTRAP_ADMIN_PASSWORD=$(python3 -c 'import secrets;print(secrets.token_urlsafe(16))')
cat >> .env <<EOF
AZIRO_BOOTSTRAP_ADMIN_USER=admin
AZIRO_BOOTSTRAP_ADMIN_PASSWORD=${AZIRO_BOOTSTRAP_ADMIN_PASSWORD}
AZIRO_AUTH_MODE=session
EOF

# Write the password somewhere you can recover it (1Password, sealed envelope, …)
echo "admin password: ${AZIRO_BOOTSTRAP_ADMIN_PASSWORD}"
```

**Verify:**
```bash
grep -E '^(POSTGRES_PASSWORD|AZIRO_SESSION_SECRET|MINIO_ROOT_USER|MINIO_ROOT_PASSWORD|AI_MODEL|AZIRO_BOOTSTRAP_ADMIN_PASSWORD)=' .env | wc -l
# Expect: 6
```

---

## Step 3 — First boot (SQLite + infrastructure services)

The first `docker compose up` starts everything EXCEPT Postgres-as-primary. The app boots against SQLite (the built-in dev default); Postgres, Redis, and MinIO come up as infrastructure, but `AZIRO_DB_URL` is still unset so the app doesn't use PG yet.

```bash
docker compose up -d
docker compose ps
```

**Verify (wait ~30s for healthchecks to settle):**

```bash
# All six services "running" and four "healthy"
docker compose ps --format 'table {{.Name}}\t{{.Status}}'

# Expected:
#   aziro      Up  (healthy)
#   postgres   Up  (healthy)
#   redis      Up  (healthy)
#   minio      Up  (healthy)
#   backup     Up
#   ofelia     Up
```

```bash
# App liveness + readiness
curl -s http://localhost:5000/api/v1/healthz | jq .
# → {"status":"ok"}

curl -s http://localhost:5000/api/v1/readyz | jq .
# → {"status":"ok","checks":{"sqlite":"ok", ...}}
# Note: "sqlite" not "postgresql" — the app is on SQLite at this stage
```

---

## Step 4 — Log in to the UI

Open `http://<vm-ip>:5000` in a browser. Log in with:
- **Username:** `admin`
- **Password:** the `AZIRO_BOOTSTRAP_ADMIN_PASSWORD` you generated in Step 2

**Verify:** you land on the dashboard (empty — no targets connected yet).

### Connect your first target (optional for now — can be done later)

The UI walks you through adding a target (Kubernetes / SSH / Docker / AWS / …). For Kubernetes:

1. Click **+ Add Target** → **Kubernetes**
2. Upload your kubeconfig or paste a context name
3. Save — the dashboard starts streaming events

---

## Step 5 — Migrate to Postgres

Until now the app has used SQLite. For v1.0 production we move durable state to Postgres while the app is briefly stopped.

```bash
# 1. Stop the app only (leave postgres running so we can migrate into it)
docker compose stop aziro

# 2. Apply Alembic migrations against the fresh Postgres
docker compose exec -T postgres env \
  AZIRO_DB_URL="postgresql+psycopg://aziro:${POSTGRES_PASSWORD}@localhost:5432/aziro" \
  python -m scripts.db upgrade 2>/dev/null || \
docker compose run --rm -e "AZIRO_DB_URL=postgresql+psycopg://aziro:${POSTGRES_PASSWORD}@postgres:5432/aziro" \
  aziro python -m scripts.db upgrade

# 3. Dry-run the SQLite → PG data copy (no writes)
docker compose run --rm -e "AZIRO_DB_URL=postgresql+psycopg://aziro:${POSTGRES_PASSWORD}@postgres:5432/aziro" \
  aziro python -m scripts.migrate_sqlite_to_pg --dry-run

# 4. Execute
docker compose run --rm -e "AZIRO_DB_URL=postgresql+psycopg://aziro:${POSTGRES_PASSWORD}@postgres:5432/aziro" \
  aziro python -m scripts.migrate_sqlite_to_pg --execute

# 5. Verify row counts match
docker compose run --rm -e "AZIRO_DB_URL=postgresql+psycopg://aziro:${POSTGRES_PASSWORD}@postgres:5432/aziro" \
  aziro python -m scripts.migrate_sqlite_to_pg --verify
```

**Verify:** the `--verify` step prints `row counts match` for every table. If it doesn't, STOP — don't flip the DSN, investigate first (see `docs/ops/backup-restore.md`).

### Cut over

```bash
# Uncomment AZIRO_DB_URL and pin it to the Postgres DSN
sed -i "s|^# AZIRO_DB_URL=.*|AZIRO_DB_URL=postgresql+psycopg://aziro:${POSTGRES_PASSWORD}@postgres:5432/aziro|" .env

# Restart the app — now on Postgres
docker compose up -d aziro
```

**Verify:**
```bash
curl -s http://localhost:5000/api/v1/readyz | jq .checks
# → {"postgresql":"ok", "sessions":"ok", "redis":"ok"}
# The "postgresql" key (not "sqlite") proves the cutover worked
```

---

## Step 6 — Smoke-test the backup pipeline

MinIO + the backup sidecar are already up, but no dump has run yet (cron fires at 02:00 UTC). Trigger the drill manually to prove the pipeline works **now**:

```bash
./ops/chaos/run-backup-drill.sh
```

**Expect:**
```
[drill] objects before: 0
[drill] backup.sh completed in 2s
[drill] objects after: 1
[drill] ✓ object count increased by 1
[drill] restore-verify.sh completed in 3s
[drill] === drill passed ===
```

If this fails, see [`docs/ops/chaos-drills.md`](./chaos-drills.md#troubleshooting) before proceeding.

---

## Step 7 — Start the observability stack (optional but recommended)

Loki + Alloy + Grafana + Prometheus ship as a separate script so you can opt out on small VMs.

```bash
# Set Grafana admin creds before first start (prevents admin/admin default)
GRAFANA_ADMIN_PASSWORD=$(python3 -c 'import secrets;print(secrets.token_urlsafe(16))')
cat >> .env <<EOF
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}
EOF
echo "grafana admin: ${GRAFANA_ADMIN_PASSWORD}"

# Bring up the stack
./obs-run.sh up

# Wait ~15s, then:
./obs-run.sh status
```

**Verify:**
- Grafana: `http://<vm-ip>:3000` — log in, `Aziro — Logs` and `Aziro — Metrics` dashboards should be present and populating
- Prometheus: `http://<vm-ip>:9090/targets` — `aziro` target should be `UP`
- Loki: `{com_aziro_service="aziro"}` should return recent log lines

---

## Step 8 — Verify graceful degradation

Prove that a backing-service outage doesn't crash the app:

```bash
./ops/chaos/kill-postgres.sh
```

**Expect:** `drill passed` — `/healthz` stays 200 while PG is stopped, `/readyz` flips to 503, both recover after PG comes back.

---

## Common operations

### Rotate admin password

```bash
# Via the UI: Settings → Change Password

# Via CLI (if locked out):
docker compose exec aziro python - <<'PY'
from auth.db import AuthStore
from store.engine import build_engine
import os, getpass
store = AuthStore(build_engine(os.environ["AZIRO_DB_URL"]))
new = getpass.getpass("new admin password: ")
store.set_password("admin", new)
PY
```

### Rotate MinIO root credentials

See [`backup-restore.md`](./backup-restore.md#rotating-minio-credentials).

### Restart / rebuild

```bash
# Config-only change (restart, preserve volumes)
docker compose restart aziro

# Code change (rebuild image)
git pull
docker compose build aziro
docker compose up -d aziro

# Nuke-and-repave (destroys data volumes — only for clean-room tests)
docker compose down -v
```

### Upgrade

```bash
cd /opt/aziro
git fetch && git checkout v<tag>
docker compose pull                # pulls redis/postgres/minio if bumped
docker compose up -d --build aziro # rebuild app only
```

### Manual backup / restore

See [`backup-restore.md`](./backup-restore.md) for the full disaster-recovery procedure.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `docker compose up` hangs on `postgres healthcheck` | Wrong `POSTGRES_PASSWORD` (changed after first-up) | `docker compose down -v` then re-up. Volume holds the old password. |
| `/readyz` returns `sqlite: ok` after cutover | `AZIRO_DB_URL` still commented out in `.env` | Uncomment, `docker compose up -d aziro` |
| `/readyz` returns `redis: fail: no pong` | Redis container not healthy, or `AZIRO_LIMITER_STORAGE` points at the wrong URL | `docker compose logs redis`; verify `redis://redis:6379/1` |
| Backup drill fails with `mc alias set failed` | MinIO creds mismatch between `.env` and the volume's initialized state | Rotate creds per backup-restore runbook |
| Grafana shows no logs | Alloy can't reach the app container | Confirm both on `aziro-net`: `docker network inspect aziro-net` |
| Login works but UI is blank | Frontend build not bundled into image | `docker compose build aziro --no-cache` |
| High memory after a week | Event retention not GCing | Check `AZIRO_EVENT_RETENTION_DAYS` (default 30); run `docker compose exec aziro python -m scripts.db gc` |

---

## What `v1.0` explicitly does NOT include

To set expectations, these are post-v1.0:
- Multi-replica HA — single container, single-replica by design
- Helm chart — docker-compose only
- Keycloak / OIDC SSO — local accounts only (admin + viewer roles)
- Automated remediation execution — AI **proposes** commands, human runs them
- Slack / PagerDuty / email notifications — alerts live in the UI + Loki
- Classical ML anomaly detection — SEV1/SEV2/SEV3 classification is rule-based
- Web terminal / YAML editor — read-only UI in v1.0

Roadmap: [`TODO.md`](../../TODO.md) → "Phase 2 — Post-v1.0".

---

## See also

- [`backup-restore.md`](./backup-restore.md) — DB-4 backup pipeline, disaster recovery
- [`chaos-drills.md`](./chaos-drills.md) — on-demand failure drills
- [`slo.md`](./slo.md) — uptime / latency / freshness targets
- [`v1.0-checklist.md`](./v1.0-checklist.md) — the checklist you walk before tagging
- [`../../.env.example`](../../.env.example) — every env var, documented inline
- [`../../TODO.md`](../../TODO.md) — work tracker with v1.0 exit criteria
