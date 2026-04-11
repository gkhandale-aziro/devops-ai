# Aziro Ops — Work Tracker

Living checklist. Check items off as they ship. Keep entries terse — link
commits or file paths instead of re-describing context.

## In progress

Week 5 — Polish & Compliance (next up)

---

## v1.0 UI Roadmap

Sources: `Aziro_Ops_UI_Roadmap_Merged.docx` + `Aziro_Ops_UIUX_Audit.docx` (2026-04-08)
Current UI score: **3.6 / 10** — target **7+ / 10** by v1.0.

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
- [x] Banner alerts for SEV1/SEV2 when user is on another page

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
- [x] Responsive on tablet (1024px+) — fluid widths + auto-fit grids (`86c77e3`)

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

### Week 5 — Polish & Compliance
Demo: Lighthouse a11y > 95, responsive on tablet, intentional copy on every state.
- [ ] Lighthouse Accessibility > 95; axe-core CI passing
- [x] Responsive on tablet (1024px+) — fluid widths + auto-fit grids (`86c77e3`)
- [x] Microcopy pass — every empty state, error, button label (`f8901d8`)
- [x] Accessibility pass — landmarks, semantic buttons, focus traps, aria-live, form labels (`2c7c139`)

### Week 6 — Freeze & Ship
Demo: tagged v1.0.0, fresh-OS bug bash passes, pilot users onboarded.
- [ ] Tagged v1.0.0 release
- [ ] Fresh-OS bug bash passes
- [ ] 2–3 internal pilot users onboarded
- [ ] 12-step keyboard-only walkthrough passes (Definition of Done)

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
- [ ] Lighthouse a11y > 95
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
