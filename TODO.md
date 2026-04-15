# Aziro Ops — Work Tracker

Living checklist. Check items off as they ship. Keep entries terse — link
commits or file paths instead of re-describing context.

## In progress

Post-v0.0.1 — hardening and deploy

---

## Remaining Work to v1.0 (verified against current code — 2026-04-15)

> Sources reviewed: UI Roadmap Merged, Priority Roadmap, UIUX Audit, Technical Gap Analysis,
> Tech Recommendations, Market Gap Analysis, ML Technical Spec (all dated April 8).
>
> ⚠️ **Audit doc is 7 days stale.** All items below are re-verified against current code.
> Items that were in the audit but are now fixed have been moved to "Audit Items Already Fixed".

### Already Fixed Since April 8 Audit (do not re-flag)

| Finding | Fix location |
|---|---|
| C-01 SSE URL | [useSSE.ts:24](frontend/src/hooks/useSSE.ts#L24) uses `/api/v1/monitor/stream` |
| H-02 body size limit | [web.py:56](ui/web.py#L56) `MAX_CONTENT_LENGTH` set |
| H-04 targets.json atomic write | [targets/manager.py:60-68](targets/manager.py#L60-L68) `.tmp + os.replace` |
| Rate limiting | [web.py:102-152](ui/web.py#L102-L152) `_rate_buckets` + middleware |
| Basic security headers | [web.py:156](ui/web.py#L156) `_add_security_headers` (X-Frame, referrer) |
| ErrorBoundary | App.tsx wraps routes |
| Dockerfile + compose | Multi-stage build present |
| .env in gitignore | Line 7 |
| Per-target health | [web.py:1251](ui/web.py#L1251) `/api/v1/health/<tid>` |

---

### P0 — Critical & High Remaining (verified unfixed)

- [ ] **C-02:** Thread-safe session state — `agent/manager.py`, `sessions/manager.py` still have no `Lock`. Add `threading.Lock()` around `_sessions` + `_messages` dicts OR construct per-request from DB.
- [ ] **C-03:** Replace Flask dev server with Gunicorn — `gunicorn -w 4 -k gevent --timeout 120 app:app`. README + CHANGELOG both confirm still Flask dev.
- [ ] **H-01:** Replace single shared `AZIRO_API_KEY` with per-user JWT (session expiry + revocation).
- [ ] **H-03:** TLS termination — nginx/caddy reverse proxy + HSTS header + deployment docs.
- [ ] **H-04 (remainder):** Atomic writes on `sessions/manager.py` (chat_sessions.json, chat_messages.json) — targets.json already done.
- [ ] **H-05:** SQLite thread-local connection cache — `store/db.py._conn()` creates a new connection per operation. Add `threading.local()` + retry-on-busy with exponential backoff.
- [ ] **H-06:** TTL caches for unbounded dicts — `_rate_buckets`, `_monitor_subs`, `_pod_seen`, `_node_seen`, `AgentSession._sessions`. Use `cachetools.TTLCache`.
- [ ] **H-07:** Move LLM retry off request thread — [providers/client.py:720](providers/client.py#L720) still calls `time.sleep(TRANSIENT_DELAY)` on the worker thread.
- [ ] **H-08:** CSRF — `Flask-WTF` tokens + Origin/Referer checks on state-changing routes.

---

### P1 — Medium Remaining (verified unfixed)

- [ ] **M-01:** 🐞 CLI stats formatter is STILL BROKEN — [agent/conversation.py:446-448](agent/conversation.py#L446-L448) uses `counts.get('L1')` for SEV3 (wrong key AND wrong mapping). Users see zero incidents.
- [ ] **M-02:** 🐞 Docker connectivity test STILL BROKEN — [web.py:422](ui/web.py#L422) `docker info --format {{.ServerVersion}}` (unquoted Go template). Docker targets misreport offline.
- [ ] **M-03:** `_trim()` still duplicated — [web.py:169](ui/web.py#L169) and [agent/manager.py:12](agent/manager.py#L12). Delete from web.py, import from agent/manager.
- [ ] **M-04:** Move chat messages to SQLite (eliminate per-token full-file rewrite of chat_messages.json).
- [ ] **M-05:** Structured logging — only `store/metrics.py` uses Python `logging`. Rest of backend still `print()`. Add `structlog` + request-ID middleware + `LOG_LEVEL`.
- [ ] **M-06 (remainder):** Generic `/healthz` + `/readyz` for k8s/LB liveness & readiness probes (per-target health already exists).
- [ ] **M-08:** Target name sanitization — [web.py:375-377](ui/web.py#L375-L377) `api_add()` only does `.strip()`. Add 64-char limit + allowlist (prompt injection guard).
- [ ] **M-09:** Content-Security-Policy header — not in `_add_security_headers`. Add `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'`.
- [ ] **M-10:** `useChat.ts` error-path — [useChat.ts:70](frontend/src/hooks/useChat.ts#L70) placeholder has `cmds: [], tools: []`; error path leaves orphan arrays. Set full message object in catch.
- [ ] **L-02:** `StreamRedactor` — track already-redacted tail to skip redundant regex pass.
- [ ] **L-04:** Vite proxy startup check — ping `/api/v1/info`, surface error if unreachable.
- [ ] **L-05:** `EventWatcher._pod_seen` TTL eviction — periodic cleanup > 2× `DEDUP_TTL`.
- [ ] **L-06:** `requirements-lock.txt` — `pip freeze` for reproducible builds.

### Frontend — Remaining UI Work

- [ ] **Phase 1 sweep**: tokenize hardcoded colors/fontSize in remaining files —
      `tabs.tsx`, `tables.tsx`, `History.tsx`, `AddTargetModal.tsx`, `Settings.tsx`,
      `CommandPalette.tsx`, `AlertCard.tsx`, `AIDrawer.tsx`, `ResourceGraph.tsx`,
      `LogStream.tsx`, `Chat.tsx`, `primitives.tsx`, `ModelStatusBanner.tsx`, `OnboardingTour.tsx`
- [ ] **Phase 3: Health Summary (backend)** — `GET /api/v1/health/<tid>` in `web.py`
      Returns `{ pods: {running,pending,failed,total}, deployments: {ready,total}, nodes: {ready,total} }`
- [ ] **Phase 3: Health Summary (frontend)** — `HealthSummary` component + integrate on Home + Dashboard
- [ ] **Restart pod** action in `CommandPalette.tsx` — add to `ACTION_VERBS`
- [ ] **Multi-pod log aggregation** — `LogStream.tsx` currently single-pod + substring; needs multi-pod + regex
- [ ] **Time tooltips** — relative ("2m ago") + absolute tooltip on all timestamps
- [ ] **Optimistic updates** — ack/resolve should update UI before server confirms
- [ ] **Fresh-OS bug bash** — full walkthrough on clean data/session/OS
- [ ] **2–3 internal pilot users onboarded**

### Backend — Security (Track B)

- [ ] **SEC-1:** Flask-Login + `users` table + bcrypt, two roles (admin, viewer)
- [ ] **SEC-2:** Audit log table — user, timestamp, target_id, command, result
- [ ] **SEC-3:** Flask-Limiter rate limits on `/api/v1/chat/*/stream` (LLM cost cap)
- [ ] **SEC-4:** CSRF + security headers (CSP, HSTS, X-Frame-Options)

### Backend — Runtime Hardening (Track B)

- [ ] **RUN-1:** Gunicorn + nginx — replace Flask dev server
- [ ] **RUN-2:** `/healthz` (liveness) and `/readyz` (DB + LLM reachability) endpoints
- [ ] **RUN-3:** Prometheus `/metrics` — request counts, LLM tokens, tool-call latencies
- [ ] **RUN-4:** structlog JSON logging + Sentry SDK integration

### Backend — Data & Infrastructure (Track B)

- [ ] **DB-1:** Postgres 16 + Alembic migrations (keep SQLite as dev default)
- [ ] **DB-2:** Redis 7 for sessions + SSE pub/sub fan-out
- [ ] **OPS-1:** Dockerfile multi-stage + `docker-compose.yml` (app + postgres + redis)
- [ ] **OPS-2:** GitHub Actions CI — pytest + ruff + pip-audit + Trivy on every PR
- [ ] **OPS-3:** Load test with k6 — 50 concurrent users, 10 SSE streams

### Ship

- [ ] **BUG:** Bug bash — full walkthrough on fresh data/session/OS
- [ ] **CI:** Lighthouse CI green on perf and a11y
- [ ] **RELEASE:** UI freeze → v1.0.0 tag + changelog + release notes

### Post-v1.0 — Phase 2 Priorities (immediate after launch)

1. Web terminal (xterm.js + WebSocket wrapping kubectl exec) — 5-7 days
2. Inline YAML editor (Monaco + diff view + kubectl apply) — 5-7 days
3. Notification channels (Slack / PagerDuty / email + routing) — 5-7 days
4. Fleet dashboard (multi-cluster grid overview) — 5-7 days
5. Change tracking timeline (deploys + config + events on one axis) — 5-7 days
6. Incident kanban board (New / Investigating / Remediated / Resolved) — 3-5 days
7. Reliability score per service (SLO compliance + incident frequency) — 3-5 days

### Post-v1.0 — Phase 3–4 (ML Intelligence)

- Classical ML: adaptive baselines, memory trajectory warnings, log intelligence
- Deep Learning: LSTM failure prediction, GNN root cause analysis
- MLOps: shadow mode, model registry, drift detection, feedback loop

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
- [ ] Multi-pod log aggregation with regex + severity coloring
- [ ] Incident timeline component
- [x] Advanced topology (pulled forward — shipped in Week 4: `bf26c6a`, `316c040`)
- [ ] Framer Motion animations

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
