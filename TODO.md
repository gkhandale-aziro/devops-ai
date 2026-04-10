# Aziro Ops — Work Tracker

Living checklist. Check items off as they ship. Keep entries terse — link
commits or file paths instead of re-describing context.

## In progress

_(nothing active)_

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
- [ ] Set up Tailwind CSS + shadcn/ui primitives (copy-paste, not a dep)
- [ ] Create `design-tokens.ts` + `tokens.css` (spacing: 4/8/12/16/24/32/48, radius: 4/8/12/9999)
- [ ] Replace inline `style={{}}` with utility classes (eliminates magic numbers)
- [ ] Adopt Lucide React for icons (replace inline SVG duplication)
- [ ] Adopt Radix UI primitives (via shadcn) for a11y baseline
- [ ] Add CVA (class-variance-authority) for button/badge variants
- [ ] Build primitives: Button, Card, Badge, Dialog, Tooltip, Toast, DataTable, Tabs

### P0 — Ship-blockers (audit critical issues)
- [ ] Remove fake sparkline data — `trendData()` in Home.tsx generates sine/cosine fakes; hide sparklines until real metrics
- [ ] Day/Night two-theme system — replace 3 dark variants (Default/Tron/Sapphire) with Day + Night; ThemeToggle in header (sun/moon icon); follow `prefers-color-scheme` + localStorage override
- [ ] Focus rings + keyboard hover states — current hover via `onMouseEnter`/`onMouseLeave` JS handlers breaks keyboard; add global `:focus-visible` ring (WCAG 2.4.7)
- [ ] Toast/notification system — no Toast/Snackbar component exists; install sonner; wire to all mutating actions
- [ ] ErrorBoundary per route — `.catch(() => {})` swallows errors silently; add error boundaries per page
- [ ] Banner alerts for SEV1/SEV2 when user is on another page

### P1 — Major quality wins
- [ ] DataTable with `@tanstack/react-table` — sort/filter/virtualize; replace hand-rolled card grids/lists (200+ pod clusters unusable today)
- [ ] Settings page — model selector, theme, shortcuts, notifications, profile, API keys (no Settings page exists currently)
- [ ] Real charts — integrate recharts + Prometheus `/metrics`; CPU/memory/events-per-minute
- [ ] Time range picker functional (1h, 6h, 24h, etc.)
- [ ] Information density increase — current 1040px max-width + 36px padding wastes >50% on wide monitors; target 1600px+ containers
- [ ] Onboarding tour (react-joyride) — "Connect your first target" wizard; guided first-run
- [ ] Login flow for non-admin accounts
- [ ] Action buttons on resources (restart/describe/logs)

### P2 — Polish & delight
- [ ] AI chat: tool-call visualization (expand/collapse) + thumbs up/down feedback + suggested follow-ups
- [ ] Cmd+K palette expanded — includes actions (restart/shell/describe/logs), not just nav
- [ ] Keyboard shortcut cheat sheet behind `?` — 15+ shortcuts working
- [ ] Confirmation Dialog for destructive actions
- [ ] Replace inline SVGs with Lucide icon components
- [ ] Empty states on every page with CTA
- [ ] Microcopy pass — every empty state, error, button label reviewed
- [ ] Responsive on tablet (1024px+)

### P3 — Nice-to-have
- [ ] Multi-pod log aggregation with regex + severity coloring
- [ ] Incident timeline component
- [ ] Topology graph: zoom/pan + live SSE + health propagation
- [ ] Framer Motion animations with `prefers-reduced-motion` support

### Week 1 — Stop the Bleeding
Demo: new user opens Day mode, sees real data, gets toast feedback, banner alerts work.
- [ ] Set up Tailwind CSS + shadcn/ui
- [ ] Create design-tokens + tokens.css
- [ ] Day/Night ThemeToggle (replaces 3-theme switcher)
- [ ] Install sonner for toast notifications
- [ ] Remove `trendData()` fake sparklines; hide until real data
- [ ] ErrorBoundary per route
- [ ] Focus-visible ring in global CSS

### Week 2 — Primitives
Demo: Dashboard uses real DataTable, Settings page exists, action buttons on resources.
- [ ] Build Button, Card, Badge, Dialog, Tooltip primitives
- [ ] DataTable with @tanstack/react-table (sort/filter/virtualize)
- [ ] Migrate Dashboard resource lists to DataTable
- [ ] Settings page (profile, theme, shortcuts, notifications)
- [ ] Confirmation Dialog for destructive actions
- [ ] Replace inline SVGs with Lucide icons

### Week 3 — Trust & Honest Data
Demo: real charts backed by Prometheus, time picker works, AI chat shows tool calls + feedback.
- [ ] Integrate recharts + wire to Prometheus /metrics
- [ ] Real CPU / memory / events-per-minute charts
- [ ] Time range picker functional
- [ ] Tool-call visualization in ChatPanel
- [ ] AI chat feedback (thumbs up/down) + follow-up suggestions
- [ ] Empty states on every page with CTA

### Week 4 — Ergonomics & Power Users
Demo: new user onboards without help; keyboard-only power users happy; topology polished.
- [ ] Onboarding tour (react-joyride) — "Connect your first target"
- [ ] Keyboard shortcut cheat sheet behind `?`
- [ ] Cmd+K palette actions (restart, shell, describe)
- [ ] Topology graph: zoom/pan + live SSE + health propagation
- [ ] Information density pass (1600px+ containers)

### Week 5 — Polish & Compliance
Demo: Lighthouse a11y > 95, responsive on tablet, intentional copy on every state.
- [ ] Lighthouse Accessibility > 95; axe-core CI passing
- [ ] Responsive on tablet (1024px+)
- [ ] Microcopy pass — every empty state, error, button label
- [ ] Accessibility pass — axe audit, fix all criticals

### Week 6 — Freeze & Ship
Demo: tagged v1.0.0, fresh-OS bug bash passes, pilot users onboarded.
- [ ] Tagged v1.0.0 release
- [ ] Fresh-OS bug bash passes
- [ ] 2–3 internal pilot users onboarded
- [ ] 12-step keyboard-only walkthrough passes (Definition of Done)

### v1.0 Exit Criteria
All must be true to ship:
- [ ] No fake data anywhere — every chart backed by real metrics or hidden
- [ ] Day + Night themes; system default honored; user override persists
- [ ] Toast feedback on every mutating action
- [ ] Notification banners for SEV1/SEV2
- [ ] Settings page (model selector, theme, shortcuts, notifications)
- [ ] DataTable used for all resource lists
- [ ] AI chat: tool calls, thumbs up/down, follow-ups
- [ ] Onboarding tour completes for new user
- [ ] Cmd+K includes actions, not just nav
- [ ] Keyboard cheat sheet + 15+ shortcuts
- [ ] Lighthouse a11y > 95
- [ ] Responsive on tablet (1024px+)
- [ ] All 7 differentiators preserved
- [ ] Microcopy reviewed on every empty state, error, button

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
- [ ] Advanced topology (zoom/pan/live SSE/health propagation)
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
