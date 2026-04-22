# Aziro Ops — Work Tracker

Living checklist. Check items off as they ship. Keep entries terse — link
commits or file paths instead of re-describing context.

## In progress

Post-v0.0.1 — Track B hardening & v1.0 ship prep.
Source: `Aziro_Ops_Priority_Roadmap.docx` (2026-04-08). UI (Track A) is
complete through Week 5; Track B below is what's left for v1.0.0 tag.

### Tier 0 gap-analysis fixes (themed phases)

Source: `Aziro_Ops_Technical_Gap_Analysis.docx` (2026-04-08). Each phase
ships as one themed PR — bundle related fixes, don't split per-bug.

- [x] **Phase 0 — Hotfix drops** — H-02 (#8), M-01 (#9), M-09 (#10),
      Tier-0 quick wins M-02+C-02+M-04 (#11)
- [x] **Phase A — Data durability** — H-04 atomic JSON writes +
      H-05 thread-local sqlite conn + busy_timeout (#12)
- [x] **Phase B — In-memory & request-thread resilience** — H-06 LRU+TTL on
      AgentSession, M-03 `_trim` dedupe, M-08 target name validation +
      JSON-serialized metadata block; H-07 retry cap and M-10 placeholder
      regression-locked (#13)
- [x] **Phase C — Observability** — M-05 structured JSON logs +
      request-ID ContextVar middleware + X-Request-ID echo, replaced
      scattered `print()`; M-06 `/api/v1/healthz` + `/api/v1/readyz`
      with auth + rate-limit bypass (#14)
- [x] **Phase D — Production server & edge hardening** (#15)
  - [x] C-03 / RUN-1: gunicorn + gevent
  - [x] H-03: HSTS header + TLS-behind-proxy + ProxyFix
  - [x] H-08 / SEC-4: Origin / Referer CSRF check + CSP / X-Frame-Options / Referrer-Policy
- [x] **Phase E — Auth baseline** (biggest, own track)
  - [x] E1 backend: H-01 / SEC-1 / SEC-2 — Flask-Login, users table, audit log, role model, AZIRO_AUTH_MODE switch (#16)
  - [x] E2 frontend: login page, AuthContext, ProtectedRoute, 401→redirect, role-gated target add/remove, logout (#17)
- [x] **Phase F — Rate limits / LLM cost cap** — SEC-3 Flask-Limiter, per-user + per-IP keying, stream endpoint caps, login brute-force cap

### Security baseline
- [x] **SEC-1** Flask-Login + `users` table + bcrypt; roles: admin, viewer (M) — shipped in Phase E1
- [x] **SEC-2** Audit log table: user, timestamp, target_id, command, result (S) — shipped in Phase E1
- [x] **SEC-3** Flask-Limiter rate limits on `/api/v1/chat/*/stream` — LLM cost cap (S) — shipped in Phase F
- [x] **SEC-4** CSRF protection + security headers (CSP, HSTS, X-Frame-Options) (S) — shipped in Phase D
- [x] **SEC-5** SSH host key verification — pinned-key strict mode (PR #22, `bbe42ec`)
- [x] **SEC-6** PII scrubbing on stored incident snapshots + retention policy (M) — shipped: `sandbox.redact.redact_text` promoted to module-level so `store.save_snapshot` / `save_analysis` reuse the same detector set that `StreamRedactor` uses on SSE output; scrub applied at the write choke point (env opt-out `AZIRO_SNAPSHOT_REDACT=0`); event retention is env-driven via `AZIRO_EVENT_RETENTION_DAYS` (default 30, snapshots cascade via FK)
- [x] **SEC-7** Feature flag / kill switch for experimental paths (S) — shipped: `config/features.py` registry (env `AZIRO_FEATURE_<NAME>` + in-process runtime overrides, fail-closed on unknown names); gates `auto_monitor`, `agent_tools`, `analyze_endpoint`; admin API at `/api/v1/admin/features` (GET open to any authed user, POST/DELETE admin-only); disabled endpoints return 503 + Retry-After; agent loop short-circuits tool calls with a placeholder when `agent_tools` is off

### Runtime hardening
- [x] **RUN-1** Gunicorn + gevent workers (drop Flask dev server) (S) — shipped in Phase D. nginx front-door deferred post-v1.0 (single-container deploy exposes gunicorn on :5000 directly).
- [x] **RUN-2** `/healthz` (liveness) + `/readyz` (DB + LLM reachability) (S) — shipped in Phase C
- [x] **RUN-3** Prometheus `/metrics` — request counts, LLM tokens, tool-call latencies (M) — shipped 2026-04-17: `observability/metrics.py`, gunicorn multi-process mode, Prometheus container in obs-run.sh, `Aziro — Metrics` dashboard
- [x] **RUN-4** structlog JSON logging + self-hosted Loki aggregation (S) — shipped: JSON envelope via `observability.configure_logging`, Alloy tails Docker stdout → Loki → Grafana `Aziro — Logs` dashboard. Loki replaces Sentry (no external SaaS per architecture call)
- [x] **RUN-5** Graceful shutdown: SIGTERM drains SSE + kills kubectl subprocesses (S) — shipped: `observability/shutdown.py` registry + `@sse_stream` wraps all 5 SSE generators in `ui/web.py`, `tracked_popen` replaces direct Popen for `kubectl logs -f`, gunicorn `worker_int` hook calls `request_shutdown()`, `/api/v1/readyz` returns 503 + `Retry-After: 30` during drain

### Durable state

Sequenced as 4 PRs (A → D). Full design in [docs/db-v1-plan.md](docs/db-v1-plan.md).

- [x] **DB-1 / PR-A** SQLAlchemy Core + Alembic, dual-backend (SQLite default, Postgres opt-in via `AZIRO_DB_URL`) — shipped 2026-04-21 (PR #31). Alembic revision `0001_baseline` freezes the pre-SA-Core schema; schema-parity tripwires in `tests/test_schema_parity.py` cover tables/columns/indexes/uniques/FKs; SQLite ≥ 3.35 asserted at engine build for `INSERT … RETURNING`; full suite 554/554 on SQLite. Postgres runtime exercise deferred to PR-C.
- [x] **DB-2 / PR-B** Redis 7 integration — shipped 2026-04-21 (PR #33, 88be6c6). Limiter + sessions + monitor pub/sub all on Redis; in-memory fallback retained for dev/pytest.
- [x] **DB-3 / PR-C** Postgres 16 production migration — shipped 2026-04-21 (5c0a4dd). `postgres:16-alpine` in compose, `scripts/migrate_sqlite_to_pg.py` verified on VM during §2 walkthrough.
- [x] **DB-4 / PR-D** Backups + restore drill — shipped 2026-04-22 on develop. `pg_dump --format=custom` nightly via ofelia, 30-day retention on MinIO, `ops/backup/restore-verify.sh` runs schema-diff + row-count at 02:30 UTC. Drill green on VM (863/863 events, pg16 `\restrict` nonces stripped before diff).

Decisions locked in (see plan for rationale):
- SQLAlchemy Core (not ORM) — thin abstraction, preserves existing SQL fidelity
- Redis scope: all three uses (limiter + pub/sub + sessions) in one PR to avoid churn
- MinIO for backup target (self-hostable, no external SaaS per architecture call)
- `AZIRO_AUTO_MIGRATE=0` default in prod (operator runs `alembic upgrade head` explicitly)

### Deploy & CI
- [x] **OPS-1** Dockerfile (multi-stage) + docker-compose.yml (app + postgres + redis) — shipped pre-v0.0.1
- [ ] **OPS-2** GitHub Actions CI: pytest + ruff + pip-audit + Trivy on every PR (S)
- [x] **OPS-3** Load test with k6: 50 concurrent users, 10 SSE streams, sustained chat (M) — shipped 2026-04-21 (PR #39, 6c1659b). p95 + error-rate gates in `ops/loadtest/smoke.js`.
- [x] **OPS-4** LLM cost controls: per-user token budgets + circuit breaker on agent loops (M) — shipped: `store.llm_usage` table (user_id/model/tokens/ts) + `record_llm_usage` / `user_tokens_today`; `LLMClient.chat` populates `usage_out` dict and fires wired-in `usage_sink` callback per call; agent loop tracks cumulative `total_tokens` and aborts once `AZIRO_AGENT_RUN_TOKEN_CAP` (default 50000) is crossed; `_check_llm_budget()` returns 429 when `AZIRO_USER_DAILY_TOKEN_BUDGET` (default 200000) is exhausted; wired into all four chat/analyze endpoints

### Docs & release
- [x] **DOCS-1** Deploy guide, ops runbook, backup/restore, SLO definitions (M) — shipped 2026-04-21 (PR #38, 8fa501c). `docs/ops/{deploy-guide,slo,chaos-drills,backup-restore,v1.0-checklist}.md`.
- [x] **REL-1** Chaos test — kill postgres, verify graceful degradation (M) — shipped as `ops/chaos/kill-postgres.sh`. Drill executed on VM 2026-04-22: healthz stayed 200, readyz flipped to 503 under DB-down, recovered in 1s.
- [ ] **REL-2** Tag v1.0.0 + changelog + release notes (S)
- [ ] **REL-3** Onboard 2–3 internal pilot users; collect feedback (S)
- [ ] **REL-4** Post-launch monitoring dashboard (errors, p95, cost) live (S)

### v1.0 exit criteria (from priority roadmap)

All must be true to tag v1.0.0:

- [x] Two roles enforced on every route (SEC-1) — `@require_role` in ui/web.py
- [x] Running under gunicorn (RUN-1) — nginx front-door deferred post-v1.0
- [x] Postgres-backed with daily backups + verified restore (DB-1, DB-4)
- [x] Deployable via `docker compose up` (single-replica Helm deferred post-v1.0)
- [x] `/healthz`, `/readyz`, `/metrics` green under k6 load test (RUN-2/3, OPS-3)
- [x] Loki aggregating errors + Prometheus scraping metrics (RUN-3/4)
      Note: Sentry replaced with Loki per project decision — no external SaaS.
- [ ] CI green: tests, lint, pip-audit, Trivy (OPS-2) — Jenkins, Wave 4/5 post-v1.0
- [x] Deploy guide + ops runbook + LLM cost controls documented (DOCS-1, OPS-4)
- [ ] v1.0.0 tagged on main with changelog (REL-2)

---

## v1.0 UI Roadmap

Sources: `Aziro_Ops_UI_Roadmap_Merged.docx` + `Aziro_Ops_UIUX_Audit.docx` (2026-04-08)
Current UI score: **7+ / 10** after Phase 1–7 overhaul (was 3.6 at audit start).

### Guiding principles
- UI-first: ship polish alongside backend hardening
- Honest data only: no fake charts/sparklines/placeholder metrics
- Trust before delight: kill credibility-killers before adding polish
- Protect differentiators: Cmd+K, AI badges, multi-cloud sidebar, topology graph, two-model AI, AddTarget wizard, log tray
- Reject enterprise clones: no dashboard builder, plugin system, CI/CD builder, Helm panel

### Differentiators (must not regress)
- Cmd+K command palette with live K8s resource search
- Inline AI badges on unhealthy resources (one-click diagnosis)
- Multi-cloud unified sidebar (K8s, SSH, Docker, AWS, GCP, Azure, Terraform)
- SVG topology graph (Ingress → Service → Deployment → Pod)
- Two-model AI display: tool calls + final answer as separate streams
- AddTarget wizard with cloud auth pre-checks
- Bottom-docked persistent log stream tray

### Design system migration (from audit)
- [x] Set up Tailwind CSS + shadcn/ui primitives (copy-paste, not a dep)
- [x] Create `design-tokens.ts` + `tokens.css` (spacing: 4/8/12/16/24/32/48, radius: 4/8/12/9999)
- [ ] Replace inline `style={{}}` with utility classes (eliminates magic numbers)
- [x] Adopt Lucide React for icons (replace inline SVG duplication)
- [ ] Adopt Radix UI primitives (via shadcn) for a11y baseline
- [ ] Add CVA (class-variance-authority) for button/badge variants
- [x] Build primitives: Button, Card, Badge, Dialog, Tooltip, Toast, DataTable, Tabs

### P0 — Ship-blockers (audit critical issues)
- [x] Remove fake sparkline data — `trendData()` removed; real metrics via MetricCollector + Recharts
- [x] Day/Night two-theme system — Day + Night with ThemeToggle; `prefers-color-scheme` + localStorage
- [x] Focus rings + keyboard hover states — global `:focus-visible` ring (WCAG 2.4.7)
- [x] Toast/notification system — sonner installed, wired to mutating actions
- [x] ErrorBoundary per route — error boundaries per page
- [x] Banner alerts for SEV1/SEV2 when user is on another page — `AlertBanner.tsx` with `useMonitorSSE`, click-to-navigate, auto-hides on /alerts

### P1 — Major quality wins
- [x] DataTable with `@tanstack/react-table` — sort/filter/virtualize; migrated all resource lists
- [x] Settings page — model selector, theme, shortcuts
- [x] Real charts — Recharts + zero-config MetricCollector (SQLite, no Prometheus required)
- [x] Time range picker functional (1h, 6h, 24h, 7d)
- [x] Information density increase — Home/layout max-width raised to 1600px (Week 4)
- [x] Onboarding tour (react-joyride) — first-run walkthrough, Replay button in Settings (`862182c`)
- [ ] Login flow for non-admin accounts
- [x] Action buttons on resources (click-to-detail with describe/logs/AI analysis)

### P2 — Polish & delight
- [x] AI chat: tool-call visualization (expand/collapse) + thumbs up/down feedback
- [x] AI chat: suggested follow-up questions — heuristic backend rules + SSE frame + chip UI (`ee72620`)
- [x] Cmd+K palette expanded — describe/logs/AI analyze actions, verb-strip parser (Week 4)
- [x] Keyboard shortcut cheat sheet behind `?` — KeyboardHelp overlay (Week 4)
- [x] Confirmation Dialog for destructive actions
- [x] Replace inline SVGs with Lucide icon components
- [x] Empty states on every page with CTA
- [x] Microcopy pass — every empty state, error, button label reviewed (`f8901d8`)
- [x] Responsive on tablet (1024px+) — AIDrawer clamp(380,42vw,520), Home/Overview auto-fit grids, Alerts toolbar flex-wrap (`86c77e3` + follow-up)

### P3 — Nice-to-have
- [ ] Multi-pod log aggregation with regex + severity coloring
- [ ] Incident timeline component
- [x] Topology graph: zoom/pan + live SSE + health propagation (`bf26c6a`, `316c040`)
- [ ] Framer Motion animations with `prefers-reduced-motion` support

### Week 1 — Stop the Bleeding ✓
Demo: new user opens Day mode, sees real data, gets toast feedback, banner alerts work.
- [x] Set up Tailwind CSS + shadcn/ui
- [x] Create design-tokens + tokens.css
- [x] Day/Night ThemeToggle (replaces 3-theme switcher)
- [x] Install sonner for toast notifications
- [x] Remove `trendData()` fake sparklines; hide until real data
- [x] ErrorBoundary per route
- [x] Focus-visible ring in global CSS

### Week 2 — Primitives ✓
Demo: Dashboard uses real DataTable, Settings page exists, action buttons on resources.
- [x] Build Button, Card, Badge, Dialog, Tooltip primitives
- [x] DataTable with @tanstack/react-table (sort/filter/virtualize)
- [x] Migrate Dashboard resource lists to DataTable
- [x] Settings page (profile, theme, shortcuts, notifications)
- [x] Confirmation Dialog for destructive actions
- [x] Replace inline SVGs with Lucide icons

### Week 3 — Trust & Honest Data ✓
Demo: real charts backed by zero-config MetricCollector, time picker works, AI chat shows tool calls + feedback.
- [x] Integrate recharts + zero-config MetricCollector (SQLite, no Prometheus required)
- [x] Real CPU / memory / disk / load charts on OverviewTab
- [x] Time range picker functional (1h/6h/24h/7d)
- [x] Tool-call visualization in ChatPanel (expandable blocks with output + duration)
- [x] AI chat feedback (thumbs up/down)
- [x] Empty states on every page with shared EmptyState component

### Week 4 — Ergonomics & Power Users ✓
Demo: new user onboards without help; keyboard-only power users happy; topology polished.
- [x] Onboarding tour (react-joyride) — first-run + Replay in Settings (`862182c`)
- [x] Keyboard shortcut cheat sheet behind `?` — KeyboardHelp overlay
- [x] Cmd+K palette actions — describe/logs/AI analyze with verb-strip parser
- [x] Topology graph: zoom/pan + live SSE + health propagation (`bf26c6a`, `316c040`)
- [x] Information density pass — Home/layout max-width → 1600px
- [x] Follow-up: ResourceModal portal fix + Cmd+K `[Exit code:]` sentinel filter

### Week 5 — Polish & Compliance ✓
Demo: Lighthouse a11y > 95, responsive on tablet, intentional copy on every state.
- [x] Lighthouse Accessibility > 95; axe-core CI passing — axe-core via vitest-axe (`fa9722c`), Lighthouse **100** on live server (`cca7af4`)
- [x] Responsive on tablet (1024px+) — AIDrawer clamp(380,42vw,520), Home/Overview auto-fit grids, Alerts toolbar flex-wrap (`86c77e3` + follow-up)
- [x] Microcopy pass — every empty state, error, button label (`f8901d8`)
- [x] Accessibility pass — landmarks, semantic buttons, focus traps, aria-live, form labels (`2c7c139`)

### Week 6 — Freeze & Ship (v0.0.1 tagged)
Demo: tagged v0.0.1, fresh-OS bug bash passes, pilot users onboarded.
- [x] Tagged v0.0.1 release (2026-04-12)
- [x] PR #5 merged to main
- [ ] Fresh-OS bug bash passes
- [ ] 2–3 internal pilot users onboarded
- [x] 12-step keyboard-only walkthrough passes (18 Playwright e2e tests)

#### DoD walkthrough audit (2026-04-12)
Static audit against the 12-step list. Gaps blocking DoD:
- [ ] **Step 2** — Login flow for non-admin accounts (deferred to post-v1.0; API key auth sufficient for single-team)
- [x] **Steps 6/7** — SEV1 banner across routes + click-to-jump (`AlertBanner.tsx`)
- [x] **Step 10** — Code copy button on Markdown `<pre>` blocks (hover-reveal Copy button, `navigator.clipboard`)
- [x] **Step 11** — Incident acknowledge action + toast (Ack button on AlertCard + `toast.success`)
- [x] **Step 8** — ToolCallBlock expand/collapse keyboard affordance (div → button, aria-expanded)
- [x] **Step 12** — Settings in Cmd+K palette

### v1.0 Exit Criteria
All must be true to ship:
- [x] No fake data anywhere — every chart backed by real metrics or hidden
- [x] Day + Night themes; system default honored; user override persists
- [x] Toast feedback on every mutating action
- [x] Notification banners for SEV1/SEV2
- [x] Settings page (model selector, theme, shortcuts, notifications)
- [x] DataTable used for all resource lists
- [x] AI chat: tool calls, thumbs up/down
- [x] AI chat: follow-up suggestions
- [x] Onboarding tour completes for new user
- [x] Cmd+K includes actions, not just nav
- [x] Keyboard cheat sheet + 15+ shortcuts
- [x] Lighthouse a11y > 95 (scored **100** — `cca7af4`)
- [x] Responsive on tablet (1024px+)
- [x] All 7 differentiators preserved
- [x] Microcopy reviewed on every empty state, error, button

### Definition of Done (12-step keyboard walkthrough)
A new engineer must complete using only keyboard:
1. Open Aziro in Day mode (system default)
2. Log in with non-admin account
3. Complete onboarding tour to connect K8s cluster
4. See real CPU / memory / events charts
5. Filter to "last 1 hour" via time range picker
6. Receive SEV1 banner while on another page
7. Click banner to jump to alert
8. Open AI drawer; see tool calls expand/collapse
9. Click a suggested follow-up question
10. Rate response thumbs-up + copy code block
11. Acknowledge incident; see toast feedback
12. Open Settings via Cmd+K (not sidebar)

### Phase 2 — Post-v1.0 (deferred, becomes priority after launch)

Ranked priorities from `Aziro_Ops_Priority_Roadmap.docx` §10 (competitive
analysis). Each is 5–7 days; order = adoption blocker severity.
- [ ] **#1** Web terminal — xterm.js + WebSocket wrapping `kubectl exec` (debug workflow blocker)
- [ ] **#2** Inline YAML editor — Monaco + diff view + `kubectl apply` (read-only UI limits usage to monitoring)
- [ ] **#3** Notification channels — Slack, PagerDuty, email + routing rules (on-call adoption blocker)
- [ ] **#4** Fleet dashboard — multi-cluster grid overview (replaces click-through-targets)
- [ ] **#5** Change tracking timeline — deploys + config + events on one axis

Smaller deferred items:
- [ ] Multi-pod log aggregation with regex + severity coloring
- [ ] Incident timeline component
- [x] Advanced topology (pulled forward — shipped in Week 4: `bf26c6a`, `316c040`)
- [ ] Framer Motion animations with `prefers-reduced-motion`

Deferred infra (post-v1.0, triggered by scale/customer need):
- [ ] FastAPI migration (trigger: Gunicorn+Flask hits load ceiling)
- [ ] Keycloak / OIDC SSO (trigger: customer ask)
- [ ] Classical ML anomaly detection (trigger: stable v1.0 baseline + data flywheel)
- [ ] Kubernetes / Helm HA (trigger: single-replica compose insufficient)
- [ ] TimescaleDB (trigger: plain Postgres struggles on event volume)
- [ ] Celery / ARQ task queue (trigger: 3rd async job type appears)
- [ ] Vault / HashiCorp secrets (trigger: multi-tenant or compliance)

### Rejected (do not revisit without customer need)
- Dashboard builder / plugin system
- CI/CD pipeline builder
- Helm panel
- Any "become Grafana/Devtron/Lens" features

## Next up — S3 polish backlog

Small, low-risk UX/a11y/cleanup items from the 2026-04-08 audit. Each
should ship as a standalone commit. Pick top-down unless a theme makes
sense to batch.

### Accessibility
- [x] Escape key closes ResourceModal (already present — tables.tsx:335)
- [x] Focus trap in ResourceModal + return focus to originating row on close
- [x] Keyboard nav for PodTable rows (↑/↓ to move, Enter to open)
- [x] Visible focus ring on all clickable Cards/rows (global `:focus-visible` outline)
- [x] ContextualHint dismiss button — covered by global focus ring
- [x] Namespace `<select>` in Dashboard header — added `aria-label="Filter by namespace"`

### Loading / error UX
- [x] Refresh button shows spinner while tab refetches
- [x] Swallowed errors — App.tsx / Home.tsx / Chat.tsx now `console.warn` on failure
- [x] Per-tab empty-state copy (KubectlTable `emptyMessage` prop wired through tabs.tsx)
- [x] Specialize SkeletonLoader per tab (cards/table/mixed variants wired via Dashboard)
- [x] Error toast/banner on tab fetch failure (auto-dismissing floating toast)

### Dead code / style hygiene
- [x] Extract shared color palette → `src/utils/theme.ts` with `C` / `SPACE` / `RADIUS` tokens (adoption ongoing, follow-up sweep across pages/dashboard)
- [~] Spacing tokens covered by `SPACE` export in `theme.ts` (same adoption follow-up)
- [x] Hoist duplicated ColorFns — `serviceTypeColorFn`, `pvStatusColorFn` exported from tables.tsx; inline svcColor in NetworkTab + ServicesTab + pvcColor in K8sStorageTab collapsed
- [~] `useCallback` on PodTable row closures — deferred; row closures capture per-row data, so real memo win requires extracting a `<PodRow>` memo component (bigger refactor, tracked under F3)
- [x] Centralize kubectl empty/error detection into one `isEmptyKubectl` / `hasKubectlData` helper (tables.tsx)
- [~] ANSI strip dedup — n/a, no ANSI stripping in either LogsTab or LogStream (audit false positive)

### State persistence
- [x] Namespace selector persists per target (`dashboard-ns-<targetId>`)
- [x] Last active tab per target (`dashboard-tab-<targetId>`)
- [x] Restore dismissed ContextualHints — "Restore tips" button in Sidebar footer clears all `hint-*` keys

### Visual polish
- [x] Status-based row tint + left accent for unhealthy pods (PodTable)
- [x] "Not Ready" pulse animation on Workloads health bar (red segment only when failedAll > 0)
- [x] PodSummaryBar segment width transition (already had cubic-bezier transition — verified)
- [x] RingChart label — absolutely-positioned HTML span, drops SVG counter-rotate hack
- [x] Card expand/collapse — max-height + opacity transition; tests updated to assert aria-expanded/aria-hidden

### Cleanup
- [x] Unused re-export audit — `tsc --noUnusedLocals --noUnusedParameters` clean; `ColorFn` has 5 legitimate consumers
- [x] `ui/web.py` → extracted `DOCKER_PS_FORMAT` constant above `TAB_COMMANDS`
- [ ] Decide: keep `frontend_dist/` in git (simplicity on VM, accept occasional pull conflicts) vs move to CI (cleaner but needs build pipeline) — deferred, needs product decision

## Next up — S4 nice-to-have backlog

Enumerated from 2026-04-08 audit after S3 batch shipped (commit `3b508cb`).
Grouped by theme; each group can ship as one commit. Batch 1 (type
tightening) is highest-leverage lowest-risk — start there.

### Batch 1: Type tightening
- [x] Extract inline API response types → `TopologyResponse` / `SearchResponse` in `types/`
- [x] Narrow `raw!.split(...)` in `tabs.tsx` — replaced with proper early-return guard
- [x] `activeTab: TabId | null` in Dashboard (uses `TabId` union from `types/`)
- [x] `PodStatus` union type + `POD_BAD_STATUSES satisfies PodStatus[]`
- [x] Explicit return types on non-component helpers — components remain inferred (React ergonomics)

### Batch 2: Docstrings (JSDoc)
- [x] `tables.tsx` — `NodeTable`, `PodTable`, `LogsTab`, `KubectlTable`, `parseWorkloadCounts`
- [x] `tabs.tsx` — all 12 tab components + `parseWorkloadCounts`
- [x] `primitives.tsx` — `RingChart`, `PodSummaryBar`, `Card`, `SkeletonLoader`, `ContextualHint`
- [x] `Dashboard.tsx TabContent` — dispatcher JSDoc with special-case notes
- [x] `theme.ts` — `C` token groups documented by purpose

### Batch 3: Naming consistency
- [x] ColorFn aliases removed — `svcColor`/`pvcColor` locals dropped, call sites use `serviceTypeColorFn`/`pvStatusColorFn` directly
- [x] `raw`/`output`/`data` audit — these are semantically distinct (local kubectl stdout / single-output backend key / full API response bag); no rename needed
- [x] Loading boolean audit — all already use `<scope>Loading` suffix pattern (`tabLoading`, `nsLoading`, `histLoading`, `chatLoading`); consistent
- [x] Predicate audit — `isBad`/`isActive`/`isError`/`isK8s`/`hasData`/`hasKubectlData` all `is*`/`has*`; renamed stray `noData` → `isEmpty` in KubectlTable

### Batch 4: Cleanup / misc
- [x] Strip dead inline `// P1:` / `// P2:` / `// P5:` refs to old audit phases (App.tsx, Sidebar.tsx)
- [x] Extract `TIMING` constants → `theme.ts` (toastDismiss wired in Dashboard; pulse/transition remain in CSS animation strings where templating them hurts clarity)
- [x] `console.warn` tag format — audit clean, all use `[Module]` prefix (App/Chat/Home)
- [x] Module-header block comments — all `pages/dashboard/*.tsx` files have JSDoc headers
- [ ] Decide `frontend_dist/index.html` in git (carried over from S3 cleanup)

## Backlog

- [x] Tests for remaining tables (NodeTable, PodTable, ResourceModal, LogsTab) — shared mock helper in `test/apiMock.ts`, 26 tests in `tables-components.test.tsx`
- [x] Live verification on VM — Gemini 2.5 Flash configured, Flask serving on 172.30.44.145:5000, UI confirmed working
- [x] Token adoption sweep across `pages/dashboard/*` — ~200+ hex literals → `C.*` tokens in primitives/tables/tabs
- [x] Extract `<PodRow>` memoized row component — `memo(PodRow)` in tables.tsx, callbacks stable via `useCallback`

## Done

- [x] Week 1 — Stop the Bleeding (theme, toasts, error boundaries, focus rings, Lucide icons)
- [x] Week 2 — Primitives (DataTable, Settings, SSH tabs, click-to-detail, confirmation dialogs)
- [x] Week 3 — Trust & Honest Data (MetricCollector, Recharts, tool-call viz, feedback, empty states)
- [x] Week 4 — Ergonomics & Power Users (density, ? cheat sheet, Cmd+K actions, tour, topology zoom/pan/SSE/health) — `862182c`, `bf26c6a`, `316c040`
- [x] S1 security fixes (`ebc27b9`)
- [x] S2 reliability + a11y (`108e31a`)
- [x] B7: shell=True refactor with env dict (`71a4b10`)
- [x] F2: Dashboard god-component split
  - primitives extraction (`a711b7d`) + tests (`4f37097`)
  - tables extraction (`68f1a08`)
  - tabs extraction (`e475d9a`)
- [x] Playwright visual regression suite — 14 specs (`d335246`, `3738e51`)
- [x] Namespace filter NAMESPACE-column fix (`bd7fd43`)
- [x] S3 polish batch — loading/error UX, helpers, persistence, visuals, cleanup (`3b508cb`)
