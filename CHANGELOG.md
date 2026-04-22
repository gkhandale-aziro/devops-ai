# Changelog

All notable changes to AziroOps are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] — 2026-04-22

First production-ready release. Turns the v0.0.1 demo into a hardened,
durable, observable service: multi-user auth, Postgres + Redis + MinIO
for durable state, Loki + Prometheus for observability, verified
backups + restore drill, chaos drill, load smoke, and a full ops
runbook. Tagged after end-to-end walkthrough of
`docs/ops/v1.0-checklist.md` on a production VM.

### Security
- **SEC-1** Flask-Login session auth with `users` table, bcrypt, and two
  roles (`admin`, `viewer`); `@require_role` guards every mutating API
- **SEC-2** `audit_log` table: user, action, target, status, remote IP,
  request ID — populated via after-request middleware for full coverage
- **SEC-3** Flask-Limiter rate limits on `/login` (brute-force) and
  `/api/v1/chat/*/stream` (LLM cost cap); Redis-backed for multi-worker
- **SEC-4** CSRF protection and security headers (CSP, HSTS gated on
  `AZIRO_ENABLE_HSTS`, X-Frame-Options, session cookie `HttpOnly`/`SameSite=Lax`)
- **SEC-5** SSH host-key verification with pinned-key strict mode
- **SEC-6** PII scrubbing on stored snapshots (shared detectors with
  SSE redactor); env-driven event retention (`AZIRO_EVENT_RETENTION_DAYS`,
  default 30) with cascade-delete on snapshots
- **SEC-7** Feature-flag registry (`config/features.py`) gating
  `auto_monitor`, `agent_tools`, `analyze_endpoint`; admin-only API at
  `/api/v1/admin/features`; disabled endpoints return 503 + Retry-After

### Runtime & observability
- **RUN-1** Gunicorn + gevent workers (Flask dev server retired)
- **RUN-2** `/healthz` (liveness) and `/readyz` (DB + LLM reachability)
- **RUN-3** Prometheus `/metrics` — RED metrics, LLM token usage,
  tool-call latencies; multi-process-mode gunicorn; `Aziro — Metrics`
  Grafana dashboard
- **RUN-4** structlog JSON logging aggregated to self-hosted Loki via
  Alloy; `Aziro — Logs` Grafana dashboard. Replaces Sentry — no
  external SaaS per architecture decision
- **RUN-5** Graceful shutdown: SIGTERM drains SSE streams, terminates
  tracked `kubectl` subprocesses, readyz returns 503 + Retry-After:30
  during drain

### Durable state
- **DB-1** SQLAlchemy Core + Alembic baseline migration; dual-backend
  (SQLite default, Postgres via `AZIRO_DB_URL`); schema-parity tripwires
- **DB-2** Redis 7 — limiter storage, flask-session server-side
  sessions, monitor SSE pub/sub fan-out across workers
- **DB-3** Postgres 16 as the production backend; SQLite→PG migration
  script (`scripts/migrate_sqlite_to_pg.py`) with dry-run + row-count
  verification; `pg_stat_statements` enabled
- **DB-4** Nightly `pg_dump --format=custom` to MinIO (S3-compatible,
  self-hosted) with 30-day retention; nightly restore-verify drill
  (`ops/backup/restore-verify.sh`) boots a scratch DB, runs schema-diff,
  and asserts row-count non-regression; pg16 `\restrict`/`\unrestrict`
  nonce noise stripped before diff

### Operations & docs
- **OPS-3** k6 load smoke — 50 VUs, 10 concurrent SSE streams,
  sustained chat; p95 + error-rate SLO gates (`ops/loadtest/smoke.js`)
- **OPS-4** Per-user LLM token budgets with daily reset; agent-loop
  circuit breaker at `AZIRO_AGENT_RUN_TOKEN_CAP` (default 50k/run)
- **DOCS-1** Full ops runbook: deploy guide, SLOs, chaos drills,
  backup/restore, v1.0 release checklist (`docs/ops/*.md`)
- **REL-1** Chaos drills — `kill-postgres.sh` verifies graceful
  degradation (healthz stable, readyz 503 under DB-down, recovery in
  single-digit seconds); `run-backup-drill.sh` end-to-end verifies
  dump → MinIO → scratch-DB restore

### Diagnosis & remediation

- **Resolve & Verify** — closes the Detect → Diagnose → Resolve → Verify
  loop inside the tool. Operators execute an editable `kubectl` command
  against the event's target; the backend polls the object (5s interval,
  15s of continuous health required, 60s total budget) and auto-flips
  the event to `resolved` on success or keeps it open with the full
  attempt trail on failure. Two entry points (single modal):
  - **History drawer** — `POST /api/v1/events/<id>/execute` dispatches
    against an existing event; admin-only, kubectl verb allowlist
    enforced (`get|describe|delete|rollout|apply|scale|patch|logs`)
  - **Dashboard pod kebab** — `POST /api/v1/targets/<tid>/execute-resolve`
    for user-initiated fixes on unhealthy pods; backend find-or-creates
    an event so the audit trail unifies with any monitor-caught
    incident for the same object/namespace
  - Execution + verification persisted as event snapshots so the
    attempt trail renders inline in the History detail drawer

### UI polish
- Day + Night themes with system-default detection and persisted override
- Toast feedback on every mutating action; SEV1/SEV2 banner notifications
- DataTable migration across all resource lists
- Onboarding tour for new users
- Cmd+K command palette including actions (not just nav)
- Keyboard cheat sheet with 15+ shortcuts; 12-step keyboard-only DoD
- Lighthouse accessibility score **100**
- All 7 differentiators preserved (Cmd+K, AI badges, multi-cloud
  sidebar, topology graph, two-model AI display, AddTarget wizard,
  log tray)

### Intentionally deferred post-v1.0
- nginx front-door (single-container deploy exposes gunicorn direct)
- Single-replica Helm chart (docker compose is the supported deploy)
- Jenkins CI (tests, lint, pip-audit, Trivy) — Wave 4/5 post-v1.0
- Web terminal, inline YAML editor, notification channels (Slack/PD),
  multi-node HA, OIDC/SSO — see `docs/ops/deploy-guide.md`

---

## [0.0.1] — 2026-04-12

First tagged release.

### Core Platform
- Flask backend with typed API (`ui/web.py`) and API key authentication (`AZIRO_API_KEY`)
- React 18 + TypeScript + Vite SPA, pre-built to `frontend_dist/`
- 8 target types: Kubernetes, SSH, Local, Docker, AWS, GCP, Azure, Terraform
- SQLite event store with snapshots and AI analyses
- SQLite MetricCollector for zero-config time series (CPU, memory, disk, load)
- Fernet-encrypted credential storage
- Docker multi-stage parallel build (8 BuildKit stages, ~800 MB final image)
- CLI mode (`main.py`) with colored terminal UI

### AI
- Two-model architecture via LiteLLM: `TOOL_MODEL` for commands, `ANSWER_MODEL` for responses
- Agentic tool loop (max 5 steps per question)
- Target-scoped streaming chat with SSE
- Tool-call visualization — expandable blocks with command, output, duration
- Follow-up suggestion chips after each AI response
- Thumbs up/down feedback
- One-shot AI diagnosis via `/api/v1/analyze/stream`
- Inline `AI` badges on unhealthy pods — one-click diagnosis
- Runtime model switching without restart

### Monitoring
- Background watcher: `kubectl get events -w` stream
- Auto-triage to SEV1 / SEV2 / SEV3
- SEV1/SEV2 alert banner across all routes with click-to-navigate
- Live Alerts page with SSE push
- Incident History with deduplication, acknowledge/resolve workflow
- Snapshot capture at the moment events fire

### Dashboard
- Tab-based resource explorer per target type (12+ tabs for K8s)
- DataTable with sort, filter, search (`@tanstack/react-table`)
- Inline kebab menu on every table row (Describe, Logs, AI Diagnose/Analyze)
- Resource detail modal (Describe / Logs / Previous Logs / AI Analysis)
- Health summary bars (pods, deployments, nodes)
- Real charts via Recharts (CPU, memory, disk, load)
- Time range picker (1h / 6h / 24h / 7d)
- Auto-refresh with configurable intervals and live staleness indicator
- Namespace filter with per-target persistence
- SVG topology graph with zoom, pan, live SSE, health propagation

### Navigation and UX
- Cmd+K command palette with live K8s resource search and verb actions
- Collapsible sidebar (56px icon-only mode) with persistence
- Breadcrumb navigation on all pages
- Day/Night theme with system default detection
- Onboarding tour (react-joyride) with replay from Settings
- Keyboard shortcut cheat sheet (`?` key, 15+ shortcuts)
- Settings page (model selector, theme, Ollama URL, shortcuts, tour)
- Toast notifications on all mutating actions (Sonner)
- Error boundaries per route
- Responsive on tablet (1024px+)

### Accessibility
- Lighthouse score: 100
- axe-core integrated in Vitest
- Focus rings, ARIA landmarks, keyboard navigation
- Focus trap in modals, arrow-key navigation on table rows

### Testing
- 153 pytest tests (backend)
- 507 Vitest unit tests (frontend)
- 18 Playwright e2e tests (DoD 12-step keyboard walkthrough)

### Known Limitations
- No multi-user authentication (API key only)
- Flask dev server (no Gunicorn/nginx)
- SQLite only (no Postgres)
- Read-only resource views (no restart/scale/delete/edit YAML)
