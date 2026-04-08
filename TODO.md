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
