# Changelog

All notable changes to AziroOps are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

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
