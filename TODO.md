# Aziro Ops — Work Tracker

Living checklist. Check items off as they ship. Keep entries terse — link
commits or file paths instead of re-describing context.

## In progress

_(nothing active)_

## Next up — S3 polish batch

Small, low-risk UX/a11y items. Each should be a standalone commit.

- [ ] Keyboard nav for PodTable (arrow up/down, Enter opens detail, Esc closes modal)
- [ ] Per-tab empty-state copy (replace generic "No data" with specific guidance)
- [ ] Persist namespace selector per target in localStorage
- [ ] Refresh button loading spinner while refetch in flight
- [ ] Subtle status-based row tint for unhealthy pods (CrashLoop/Failed)
- [ ] ResourceModal: Esc-to-close + focus trap

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
