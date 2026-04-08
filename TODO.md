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
- [ ] Escape key closes ResourceModal (currently only the ✕ button)
- [ ] Focus trap in ResourceModal + return focus to originating row on close
- [ ] Keyboard nav for PodTable rows (↑/↓ to move, Enter to open)
- [ ] Visible focus ring on all clickable Cards/rows (`:focus-visible` outline)
- [ ] ContextualHint dismiss button — ensure visible focus ring
- [ ] Namespace `<select>` in Dashboard header — add `aria-label="Filter by namespace"`

### Loading / error UX
- [ ] Refresh button shows spinner while tab refetches (currently silent reload)
- [ ] Swallowed errors — `App.tsx:26-27`, `Home.tsx:78`, `Chat.tsx:22` use `.catch(() => {})`; surface a toast or sidebar indicator
- [ ] Per-tab empty-state copy (replace "No data" with specific guidance per tab)
- [ ] Specialize SkeletonLoader per tab (card grid for Overview, list shape for tables)
- [ ] Error toast/banner on tab fetch failure in addition to the inline red box

### Dead code / style hygiene
- [ ] Extract shared color palette — hex literals repeated across `pages/dashboard/*` (`#2d3148`, `#0b0d14`, `#818cf8`, `#22c55e`, …)
- [ ] Extract spacing tokens (4/8/12/16) — 250 inline numeric styles in `pages/dashboard/*`
- [ ] Hoist duplicated ColorFns (`svcColor`, `pvcColor`, pod status) to a shared map in `tables.tsx`
- [ ] Wrap hot-path `onClick={() => ...}` closures with `useCallback` (PodTable rows, tab bar) — enables memoization
- [ ] Centralize kubectl empty/error detection into one `isEmptyKubectl(raw)` helper
- [ ] Deduplicate ANSI stripping between `LogsTab` and `LogStream` component

### State persistence
- [ ] Namespace selector persists per target in localStorage
- [ ] Last active tab per target in localStorage
- [ ] Settings reset for dismissed ContextualHints

### Visual polish
- [ ] Subtle status-based row tint for unhealthy pods (CrashLoop/Failed/Error)
- [ ] Extend "Not Ready" pulse animation from Events tab to Workloads health bar
- [ ] Animate PodSummaryBar segment width changes on namespace filter
- [ ] RingChart label — use straight `<text>` with counter-rotate instead of CSS rotate hack
- [ ] Card expand/collapse — add max-height transition

### Cleanup
- [ ] Audit for unused re-exports (e.g. `ColorFn` type)
- [ ] `ui/web.py` TAB_COMMANDS — extract hardcoded docker table format to a constant
- [ ] Consider moving `frontend_dist/` out of git (CI artifact) — caused VM pull conflict today

## Backlog

- [ ] S4 nice-to-have items (deferred from audit — list not yet enumerated)
- [ ] Tests for remaining tables (NodeTable, PodTable, ResourceModal, LogsTab) — need shared api mock helper
- [ ] Live verification on VM after each polish batch

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
