# Aziro Ops — Work Tracker

Living checklist. Check items off as they ship. Keep entries terse — link
commits or file paths instead of re-describing context.

## In progress

_(nothing active)_

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

- [ ] Tests for remaining tables (NodeTable, PodTable, ResourceModal, LogsTab) — need shared api mock helper
- [ ] Live verification on VM after each polish batch
- [ ] Token adoption sweep across `pages/dashboard/*` (use `C` / `SPACE` / `RADIUS` from `theme.ts`)
- [ ] Extract `<PodRow>` memoized row component (enables real `useCallback` win)

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
