# AziroOps

> AI-powered DevOps command center — monitor, diagnose, and fix infrastructure with natural language.

AziroOps connects to Kubernetes clusters, servers, Docker hosts, and cloud accounts, providing a unified dashboard with real-time monitoring, agentic AI chat, and intelligent incident management.

**v0.0.1** — First tagged release. Feature-complete for single-user teams.

---

## Supported Targets

| Type | Connection | Capabilities |
|------|-----------|-------------|
| **Kubernetes** | kubectl context | Nodes, Pods, Deployments, Services, Ingress, Storage, Events, Topology graph |
| **SSH** | Password or key | CPU, Memory, Disk, Network, Logs, Services, Processes, Security |
| **Local** | Auto-detected | Same as SSH — auto-registered on Linux hosts |
| **Docker** | Local or remote | Containers, Images, Networks, Volumes, Stats |
| **AWS** | CLI profile + region | EC2, S3, EKS, RDS, Account info |
| **GCP** | Project ID | Compute, GKE, Storage, IAM |
| **Azure** | Subscription ID | VMs, AKS, Storage, Resource Groups |
| **Terraform** | Workspace dir | State, Plan, Outputs |

---

## Features

### Dashboard
- Tab-based resource explorer per target type
- **Kubernetes**: Workloads, Nodes, Pods, Services, Ingress, Storage, Network, Events
- **SSH/Local**: Overview with ring charts (CPU/Memory/Disk), Services, Processes, Logs, Network, Storage, Security
- **Docker**: Containers, Images, Networks, Volumes, Stats
- Click any resource row to open detail modal (Describe / Logs / Previous Logs / AI Analysis)
- Inline kebab menu (three-dot) on every table row — Describe, Stream Logs, AI Diagnose/Analyze
- Inline `AI` badges on unhealthy pods — one-click diagnosis without opening chat
- Health summary bars: pods running/pending/failed, deployments ready/total, nodes ready/total
- Auto-refresh with configurable intervals (15s / 30s / 60s / off) and live staleness indicator
- Namespace filter with per-target persistence

### AI Chat
- Target-scoped chat — ask about a specific cluster, server, or container
- General sessions with persistent conversation history
- Streaming responses (SSE) with Markdown rendering and syntax-highlighted code blocks
- Two-model architecture: fast model for tool calls, smarter model for final answers
- Tool-call visualization — expandable blocks showing command, output, and duration
- Follow-up suggestion chips after each AI response
- Thumbs up/down feedback on AI responses
- Code block copy button (hover-reveal)

### Monitoring and Alerts
- Background watcher streams Kubernetes events via `kubectl get events -w`
- Auto-triages to **SEV1** (critical), **SEV2** (warning), **SEV3** (info)
- SQLite event store with snapshots captured at the moment of the event
- Live Alerts page with SSE push — no polling
- SEV1/SEV2 alert banner across all routes — click to jump to alert detail

### Incident History
- Full incident log with inline AI diagnosis
- Filter by severity, status, namespace, or resource name
- Acknowledge / Resolve workflow with toast feedback
- Event deduplication — groups repeated events by object + reason with count

### Navigation and UX
- **Cmd+K command palette** — search targets, pages, and live pods/nodes/deployments; verb actions (describe, logs, AI analyze)
- **Collapsible sidebar** — icon-only mode at 56px, with tooltips; persists across sessions
- **Breadcrumb navigation** on all pages (Home > Dashboard > Target > Tab)
- **Day/Night theme** with system default detection and manual toggle
- **Onboarding tour** (react-joyride) — first-run walkthrough, replay from Settings
- **Keyboard shortcut cheat sheet** — press `?` to view 15+ shortcuts
- **Settings page** — AI model selector, Ollama URL, theme toggle, keyboard shortcuts, replay tour
- **Toast notifications** on every mutating action (Sonner)
- **Error boundaries** per route with recovery UI
- **Responsive** on tablet (1024px+)
- **Accessibility** — Lighthouse score 100, axe-core clean, focus rings, ARIA landmarks, keyboard navigation

### SVG Topology Graph
- Ingress > Service > Deployment > Pod network flow
- Zoom, pan, live SSE updates
- Health propagation — unhealthy pods tint upstream nodes

---

## What Sets AziroOps Apart

Compared to Lens, Portainer, Rancher, Grafana, Datadog, and similar tools:

| Feature | AziroOps | Others |
|---------|----------|--------|
| Cmd+K with live K8s resource search | Yes | Lens has search, no verb actions |
| Multi-cloud sidebar (K8s + SSH + Docker + AWS + GCP + Azure + Terraform) | Yes | Usually single-target |
| Inline AI badges on unhealthy resources | Yes | No |
| Two-model AI (tool calls + answer as separate streams) | Yes | Single-model or no AI |
| SVG topology with live SSE health propagation | Yes | Lens has it, most don't |
| Cloud auth pre-checks in AddTarget wizard | Yes | No |
| Persistent log stream tray (dev-tools pattern) | Yes | Modal-based |

---

## Supported AI Models

Uses **LiteLLM** — supports 100+ providers. Set `AI_MODEL` or use separate `TOOL_MODEL` / `ANSWER_MODEL`.

| Provider | Example model | API key env var |
|----------|--------------|-----------------|
| **Ollama** (local, free) | `ollama/llama3.1:8b` | — |
| **Google Gemini** | `gemini/gemini-2.0-flash` | `GEMINI_API_KEY` |
| **OpenAI** | `gpt-4o-mini`, `gpt-4o` | `OPENAI_API_KEY` |
| **Anthropic Claude** | `claude-haiku-4-5-20251001` | `ANTHROPIC_API_KEY` |
| **Groq** (fast, free tier) | `groq/llama-3.1-8b-instant` | `GROQ_API_KEY` |
| **AWS Bedrock** | `bedrock/anthropic.claude-3-haiku` | AWS credentials |
| **Azure OpenAI** | `azure/my-gpt4-deployment` | `AZURE_API_KEY` |
| **Mistral** | `mistral/mistral-large-latest` | `MISTRAL_API_KEY` |
| **Together AI** | `together_ai/meta-llama/Llama-3-8b` | `TOGETHERAI_API_KEY` |
| **Deepseek** | `deepseek/deepseek-chat` | `DEEPSEEK_API_KEY` |
| **Cohere** | `cohere/command-r-plus` | `COHERE_API_KEY` |

### Two-model architecture

Fast model for tool calls, smart model for final answers:

```bash
TOOL_MODEL=groq/llama-3.1-8b-instant ANSWER_MODEL=claude-haiku-4-5-20251001 python3 app.py
```

### Recommended Ollama models

| Model | Size | VRAM | Best for | Install |
| ----- | ---- | ---- | -------- | ------- |
| **`llama3.1:8b`** | 4.7 GB | 6 GB | Default all-rounder | `ollama pull llama3.1:8b` |
| **`qwen2.5:7b`** | 4.4 GB | 6 GB | Strong tool calling | `ollama pull qwen2.5:7b` |
| **`mistral:7b`** | 4.1 GB | 6 GB | Fast, concise — good TOOL_MODEL | `ollama pull mistral:7b` |
| **`gemma3:4b`** | 3.3 GB | 4 GB | Lightweight — 8 GB RAM laptops | `ollama pull gemma3:4b` |
| **`llama3.1:70b`** | 40 GB | 48 GB | Best local quality — needs GPU | `ollama pull llama3.1:70b` |
| **`deepseek-r1:8b`** | 4.9 GB | 6 GB | Strong reasoning | `ollama pull deepseek-r1:8b` |

### Recommended setups

```bash
# Budget (8 GB RAM) — single model
AI_MODEL=ollama/gemma3:4b

# Standard (16 GB RAM)
TOOL_MODEL=ollama/mistral:7b
ANSWER_MODEL=ollama/llama3.1:8b

# Power (24+ GB RAM)
TOOL_MODEL=ollama/qwen2.5:7b
ANSWER_MODEL=ollama/llama3.1:70b

# Hybrid: local tool calls + cloud answers (best cost-to-quality)
TOOL_MODEL=ollama/qwen2.5:7b
ANSWER_MODEL=claude-haiku-4-5-20251001
```

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/gkhandale-aziro/devops-ai.git
cd devops-ai
pip install -r requirements.txt
cp .env.example .env
```

### 2. Configure AI model

Pick **one** option:

**Option A — Ollama (local, free, private)**

```bash
# Install: https://ollama.com/download
ollama pull llama3.1:8b
# No API key needed
```

**Option B — Cloud API key**

Add to `.env`:

```bash
GEMINI_API_KEY=...
AI_MODEL=gemini/gemini-2.0-flash
```

Or OpenAI (`OPENAI_API_KEY`), Anthropic (`ANTHROPIC_API_KEY`), Groq (`GROQ_API_KEY`), etc.

**Option C — Two-model setup (recommended)**

```bash
TOOL_MODEL=groq/llama-3.1-8b-instant
ANSWER_MODEL=claude-haiku-4-5-20251001
```

### 3. Configure API authentication

```bash
# Generate a secure key
export AZIRO_API_KEY=$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')

# Or add to .env
echo "AZIRO_API_KEY=$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')" >> .env
```

The frontend sends this automatically. For direct API calls:

```bash
curl -H "Authorization: Bearer <your-key>" http://localhost:5000/api/v1/targets
```

> **Warning:** Without `AZIRO_API_KEY`, all API routes are open. Always set it before exposing to any network.

### 4. Run

```bash
# Web mode (React dashboard)
python3 app.py
# → http://localhost:5000

# CLI mode
python3 main.py
python3 main.py --target prod-k8s --monitor
```

### 5. Frontend development

The React SPA is pre-built in `frontend_dist/` — `python3 app.py` serves it with no build step. Node.js is only needed for frontend changes.

```bash
cd frontend
npm install           # first time only
npm run dev           # Vite dev server on :5173, proxies /api to :5000
npm run build         # rebuild frontend_dist/ for production
npm run test          # Vitest unit tests (507 tests)
npm run test:e2e      # Playwright e2e tests (18 tests)
```

Requires Node.js 18+.

---

## Docker

### Multi-stage parallel build

The Dockerfile uses 8 parallel BuildKit stages — each CLI downloads concurrently, then only the binaries are copied into the final slim image.

```text
┌──────────── PARALLEL (BuildKit) ─────────────┐
│  cli-kubectl    static binary       ~50 MB    │
│  cli-aws        AWS CLI v2 zip      ~60 MB    │
│  cli-gcloud     google/cloud-sdk    ~180 MB   │
│  cli-azure      pip install azure   ~200 MB   │
│  cli-terraform  static binary       ~80 MB    │
│  cli-helm       static binary       ~50 MB    │
│  cli-docker     static binary       ~60 MB    │
│  python-deps    venv + pip          ~30 MB    │
└──────────────────────────────────────────────┘
                      │ COPY --from=*
                      ▼
┌──────────── FINAL (python:3.12-slim) ────────┐
│  System tools (ps, df, ip, dig, etc.)        │
│  All CLI binaries from above                 │
│  Python venv + app code + pre-built SPA      │
│  Total: ~800 MB                              │
└──────────────────────────────────────────────┘
```

**Requires:** Docker with BuildKit (`docker-buildx` plugin).

Runs as non-root `aziro` user. Docker Compose enforces resource limits (2 GB RAM, 2 CPUs).

### Build and run

```bash
# Build (~2-3 min cold, <30s warm cache)
DOCKER_BUILDKIT=1 docker build -t aziro-ops .

# Run with the launcher script
chmod +x docker-run.sh
./docker-run.sh

# Or Docker Compose
docker compose up --build
```

The launcher script pre-mounts all credential directories (kubeconfig, AWS, GCP, Azure, SSH, Docker socket). They're live bind mounts — credentials added on the host appear inside instantly. No restart needed.

Alternatively, paste credentials directly in the UI (kubeconfig content, GCP SA JSON, SSH keys, AWS access keys). Written to the data volume and encrypted at rest.

### Using with Ollama

Ollama runs on the host, not in the container:

```bash
# Linux/Codespace/WSL — rebind so Docker can reach it
OLLAMA_HOST=0.0.0.0:11434 ollama serve

# macOS — default is fine
ollama serve

# In .env:
OLLAMA_API_BASE=http://host.docker.internal:11434
```

> On Linux, Ollama defaults to `127.0.0.1` which containers cannot reach. You **must** set `OLLAMA_HOST=0.0.0.0:11434`.

### Persistent data

All state in the `/app/data` volume:

| File | Contents |
| ---- | -------- |
| `.aziro_key` | Fernet encryption key |
| `targets.json` | Encrypted target configurations |
| `chat_sessions.json` | Chat session metadata |
| `chat_messages.json` | Chat message history |
| `aziro.db` | SQLite event store (incidents, snapshots, analyses) |
| `metrics.db` | SQLite metrics store (CPU, memory, disk, load time series) |
| `creds/<tid>/` | Inline credentials pasted via UI |

**Backup:**

```bash
docker run --rm -v aziro-data:/data -v $(pwd):/backup alpine tar czf /backup/aziro-backup.tar.gz /data
```

See [`docs/setup-guide.md`](docs/setup-guide.md) for the full Docker reference and troubleshooting.

---

## Observability (opt-in)

Aziro ships with a self-hosted log stack — Loki + Alloy + Grafana — run as plain `docker run` containers alongside the app. No Docker Compose, no Helm, no external dependencies. Nothing runs unless you ask for it; nothing leaves your host when it does.

```bash
./docker-run.sh --rebuild   # app (creates aziro-net, labels container for scraping)
./obs-run.sh up             # loki + alloy + grafana on the same network
# Grafana: http://localhost:3000  (admin / admin by default)
```

The app emits one JSON log line per event with a per-request `request_id` so you can trace a client-side error to a server log line. Alloy tails the `aziro` container's stdout via the Docker socket, parses the JSON envelope, and pushes to Loki; the `Aziro — Logs` dashboard is pre-provisioned.

See [`obs/README.md`](obs/README.md) for query examples, retention tuning, and how the pipeline is wired. A Helm chart with `observability.enabled` lands in v1.1 (OBS-1) — the same Loki/Grafana configs port over, only Alloy's source stage changes.

---

## Architecture

### Project structure

```
devops-ai/
├── app.py                       ← Flask web server entry point
├── main.py                      ← CLI entry point (TerminalUI + agent loop)
├── Dockerfile                   ← Multi-stage parallel build (8 BuildKit stages)
├── docker-compose.yml           ← Compose with resource limits
├── docker-run.sh                ← Launcher script (mounts credentials)
├── .env.example                 ← Environment variable template
│
├── ui/
│   ├── web.py                   ← Flask routes + API key auth middleware (~50 endpoints)
│   └── terminal.py              ← CLI terminal UI
│
├── frontend/                    ← React 18 + TypeScript + Vite
│   ├── src/
│   │   ├── App.tsx              ← Root: routing, sidebar, alert banner, monitor state
│   │   ├── pages/
│   │   │   ├── Home.tsx         ← Landing — stat cards, health bars, recent events
│   │   │   ├── Dashboard.tsx    ← Target dashboard — tab dispatcher, chat, topology
│   │   │   ├── Alerts.tsx       ← Live SSE alerts with start/stop monitor
│   │   │   ├── History.tsx      ← Incident log with detail panel + deduplication
│   │   │   ├── Chat.tsx         ← General AI chat sessions
│   │   │   ├── Settings.tsx     ← Models, theme, Ollama URL, shortcuts, tour replay
│   │   │   └── dashboard/
│   │   │       ├── tabs.tsx         ← 12+ tab components (Workloads, Pods, Overview…)
│   │   │       ├── tables.tsx       ← PodTable, NodeTable, ResourceModal, LogsTab
│   │   │       └── primitives.tsx   ← RingChart, PodSummaryBar, Card, SkeletonLoader
│   │   ├── components/
│   │   │   ├── Sidebar.tsx          ← Collapsible nav with target connections
│   │   │   ├── CommandPalette.tsx   ← Cmd+K with live search + verb actions
│   │   │   ├── ChatPanel.tsx        ← Streaming chat with tool-call blocks
│   │   │   ├── ResourceGraph.tsx    ← SVG topology with zoom/pan/SSE
│   │   │   ├── LogStream.tsx        ← EventSource log tray
│   │   │   ├── AlertBanner.tsx      ← Route-persistent SEV1/SEV2 banner
│   │   │   ├── AlertCard.tsx        ← Alert card with AI + ack actions
│   │   │   ├── OnboardingTour.tsx   ← react-joyride tour
│   │   │   ├── AddTargetModal.tsx   ← Wizard with cloud auth pre-checks
│   │   │   ├── KeyboardHelp.tsx     ← ? shortcut overlay
│   │   │   ├── ModelStatusBanner.tsx← AI model health indicator
│   │   │   ├── Markdown.tsx         ← Rendered markdown with copy button
│   │   │   ├── ErrorBoundary.tsx    ← Per-route error boundary
│   │   │   └── confirm-dialog.tsx   ← Destructive action confirmation
│   │   ├── components/ui/           ← Shared primitives (shadcn-inspired)
│   │   │   ├── data-table.tsx       ← @tanstack/react-table + kebab menu
│   │   │   ├── health-summary.tsx   ← Pod/deploy/node status bar
│   │   │   ├── metric-chart.tsx     ← Recharts time series
│   │   │   ├── time-range-picker.tsx
│   │   │   ├── breadcrumb.tsx, badge.tsx, button.tsx, card.tsx
│   │   │   ├── dialog.tsx, dropdown-menu.tsx, input.tsx, tooltip.tsx
│   │   │   └── empty-state.tsx
│   │   ├── hooks/
│   │   │   ├── useChat.ts           ← SSE chat with tool-call parsing
│   │   │   ├── useChatStore.ts      ← Zustand-like chat session state
│   │   │   ├── useSSE.ts            ← Monitor SSE with exponential backoff
│   │   │   ├── useMetrics.ts        ← Polling metrics API
│   │   │   └── useAutoRefresh.ts    ← Configurable refresh intervals
│   │   ├── stores/
│   │   │   └── resourceDetailStore.ts ← Global resource detail modal state
│   │   ├── api/client.ts            ← Typed API layer + SSE stream reader
│   │   ├── utils/
│   │   │   ├── theme.ts             ← Design tokens (colors, spacing, radius, fonts)
│   │   │   ├── animations.ts        ← Shared animation styles
│   │   │   ├── toast.ts             ← Sonner toast wrapper
│   │   │   ├── targetIcons.tsx      ← Target type → Lucide icon mapping
│   │   │   └── parseKubectl.ts      ← kubectl output → table parser
│   │   └── types/index.ts           ← Shared TypeScript types + tab registry
│   └── e2e/                         ← Playwright specs
│       ├── dod-walkthrough.spec.ts   ← 18 tests: DoD 12-step walkthrough
│       ├── dashboard.spec.ts         ← Dashboard visual regression
│       ├── week1.spec.ts             ← Theme + toast smoke tests
│       └── fixtures.ts               ← Mock API data + route helpers
│
├── agent/                       ← Agentic AI loop
│   ├── conversation.py          ← SSE streaming + tool loop (max 5 steps)
│   ├── manager.py               ← Per-target message history
│   └── needs_tools.py           ← Greeting vs infra-question classifier
│
├── providers/
│   └── client.py                ← LiteLLM wrapper: TOOL_MODEL / ANSWER_MODEL routing
│
├── tools/                       ← One file per target type
│   ├── executor.py              ← Routes to correct tool, parallel _run_many
│   ├── base.py                  ← run_command(), 30s timeout, truncation
│   ├── filter.py                ← is_destructive() — blocks dangerous commands
│   ├── kubectl.py, ssh.py, docker.py, local.py
│   └── aws.py, gcp.py, azure.py, terraform.py
│
├── monitor/                     ← Background event watcher
│   ├── watcher.py               ← kubectl get events -w stream
│   └── triage.py                ← SEV1/SEV2/SEV3 classifier
│
├── store/
│   ├── db.py                    ← SQLite: events, snapshots, analyses
│   └── metrics.py               ← SQLite MetricCollector (zero-config time series)
│
├── sessions/
│   └── manager.py               ← Chat sessions persisted to JSON
│
├── targets/
│   ├── manager.py               ← Connection CRUD, credential masking
│   └── crypto.py                ← Fernet encryption for credentials at rest
│
├── sandbox/                     ← Execution isolation
│   ├── safe.py                  ← Read-only command whitelist
│   ├── docker_sandbox.py        ← Container isolation
│   ├── executor.py              ← SANDBOX=safe|docker|local routing
│   └── redact.py                ← StreamRedactor — scrubs secrets from SSE
│
├── prompts/
│   ├── system_prompt.txt        ← Editable system prompt
│   └── builder.py               ← Injects live pod list at startup
│
├── docs/
│   ├── setup-guide.md           ← Full Docker + target connection guide
│   └── quickstart.md            ← Getting started in 5 minutes
│
└── tests/                       ← 153 pytest + 507 Vitest + 18 Playwright
```

### Request flow

```
Browser (React SPA)
       │
       │  HTTP / SSE
       ▼
ui/web.py  (Flask + AZIRO_API_KEY middleware)
       │
       ├─ /api/v1/info              → runtime model + version info
       ├─ /api/v1/models/*          → list, set, health check, Ollama URL
       ├─ /api/v1/targets (CRUD)    → targets/manager.py  (credential-masked)
       ├─ /api/v1/cloud/check/<p>   → cloud auth pre-check (AWS/GCP/Azure)
       ├─ /api/v1/tab/<tid>/<tab>   → tools/executor.py   (parallel _run_many)
       ├─ /api/v1/resource/<tid>    → tools/executor.py   (describe + logs)
       ├─ /api/v1/namespaces/<tid>  → kubectl get namespaces (namespace filter)
       ├─ /api/v1/topology/<tid>    → kubectl → structured JSON (nodes/edges)
       ├─ /api/v1/logs/<tid>/stream → subprocess kubectl logs -f (SSE)
       ├─ /api/v1/search/<tid>      → parallel kubectl grep (Cmd+K)
       ├─ /api/v1/chat/<tid>/stream → agent/conversation.py (tool loop + stream)
       ├─ /api/v1/analyze/stream    → one-shot AI diagnosis (SSE)
       ├─ /api/v1/sessions/...      → sessions/manager.py (persistent history)
       ├─ /api/v1/monitor/...       → monitor/watcher.py (SSE push + status)
       ├─ /api/v1/health/<tid>      → pod/deploy/node counts
       ├─ /api/v1/metrics/<tid>     → store/metrics.py (time series)
       ├─ /api/v1/events/...        → store/db.py (SQLite with JOIN)
       ├─ /api/v1/feedback          → AI response thumbs up/down
       └─ /api/v1/stats             → event statistics + counts
```

### AI agent loop

```
User message
      │
      ▼
agent/needs_tools.py  (greeting or infra question?)
      │
      ├─ greeting/general  →  providers/chat_stream()  →  SSE → browser
      │
      └─ infra question
              │
              └──▶  agent/conversation.py  (max 5 tool steps)
                          │
                          ├─ LLM [TOOL_MODEL] picks command
                          ├─ tools/executor.py runs on target
                          ├─ result fed back → repeat if needed
                          └─ LLM [ANSWER_MODEL] streams final answer → browser
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_MODEL` | `ollama/llama3.1:8b` | Model for both tool calls and answers |
| `TOOL_MODEL` | — | Override model for tool calls only |
| `ANSWER_MODEL` | — | Override model for final answers only |
| `OLLAMA_API_BASE` | — | Ollama URL. Required in Docker: `http://host.docker.internal:11434` |
| `AZIRO_API_KEY` | — | Bearer token for API auth. Unset = no auth (dev only) |
| `AZIRO_DATA_DIR` | Project root | Data directory. Docker sets to `/app/data` |
| `AZIRO_KEY_FILE` | `$AZIRO_DATA_DIR/.aziro_key` | Fernet key location |
| `SANDBOX` | `safe` | Execution mode: `safe`, `docker`, or `local` |
| `PORT` | `5000` | Web server port |

### Runtime model switching

Change AI models without restarting:

```bash
# Check current
curl http://localhost:5000/api/v1/info -H "Authorization: Bearer <key>"

# List Ollama models
curl http://localhost:5000/api/v1/models -H "Authorization: Bearer <key>"

# Switch at runtime
curl -X PUT http://localhost:5000/api/v1/models \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"tool_model": "groq/llama-3.1-8b-instant", "answer_model": "gpt-4o-mini"}'
```

---

## Testing

| Suite | Count | Command |
|-------|-------|---------|
| Python (pytest) | 153 | `pytest` |
| Frontend unit (Vitest) | 507 | `cd frontend && npm test` |
| E2E (Playwright) | 18 | `cd frontend && npm run test:e2e` |
| Accessibility (axe-core) | Integrated in Vitest | Lighthouse score: **100** |

---

## Known Limitations

- No multi-user authentication (API key auth only; login deferred post-v1.0)
- Flask dev server (no Gunicorn/nginx production server yet)
- SQLite only (no Postgres migration yet)
- Read-only resource views (describe/logs/AI — no restart/scale/delete/edit YAML)

---

## System Requirements

- Python 3.10+ (Docker image uses 3.12)
- `pip install -r requirements.txt`
- At least one AI provider (Ollama locally, or any cloud API key)
- CLI tools as needed: `kubectl`, `docker`, `aws`, `gcloud`, `az`, `terraform`
- Node.js 18+ (only for frontend development)

---

## License

Proprietary. Internal use only.
