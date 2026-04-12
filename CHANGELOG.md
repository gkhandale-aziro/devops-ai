# Changelog

All notable changes to AziroOps are documented here.

## [0.0.1] — 2026-04-12

First tagged release.

### Added
- AI-powered diagnostics for Kubernetes, SSH, Docker, AWS, GCP, Azure, Terraform
- Two-model AI architecture (tool calls + answer streams via LiteLLM)
- Real-time monitoring with SSE alerts (SEV1/SEV2/SEV3 triage)
- React 18 + TypeScript SPA with Vite
- Day/Night theme system with system default detection
- Cmd+K command palette with live resource search and verb actions
- DataTable with sort/filter on all resource views (@tanstack/react-table)
- Settings page (model selector, theme, Ollama URL, keyboard shortcuts)
- Onboarding tour (react-joyride) with replay from Settings
- Collapsible sidebar with icon-only mode (56px)
- Breadcrumb navigation on all pages
- Health summary bars (pods, deployments, nodes)
- Auto-refresh with configurable intervals (15s/30s/60s/off) and staleness indicator
- Inline kebab menu on table rows (Describe, Stream Logs, AI Diagnose/Analyze)
- AI chat: tool-call visualization, follow-up suggestions, thumbs up/down feedback
- SEV1/SEV2 alert banner across all routes with click-to-navigate
- Incident History with event deduplication and acknowledge/resolve workflow
- SVG topology graph with zoom/pan, live SSE, and health propagation
- Resource detail modal (Describe, Logs, Previous Logs, AI Analysis tabs)
- Toast notifications on all mutating actions (Sonner)
- ErrorBoundary per route
- API key authentication (AZIRO_API_KEY Bearer token)
- Docker multi-stage parallel build (8 BuildKit stages, ~800MB final image)
- 507 Vitest unit tests, 18 Playwright e2e tests, 153 pytest tests
- Lighthouse accessibility score: 100
- Responsive on tablet (1024px+)

### Known Limitations
- No multi-user authentication (API key only, login deferred to post-v1.0)
- Flask dev server (no Gunicorn/nginx yet)
- SQLite only (no Postgres migration yet)
- No write operations on resources (restart/scale/delete/edit YAML)
