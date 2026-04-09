# Aziro Ops

> AI-powered DevOps command center — monitor, inspect, and fix your infrastructure with natural language.

Aziro Ops connects to your servers, Kubernetes clusters, and cloud accounts and gives you a professional dashboard with real-time monitoring, agentic AI chat, and intelligent incident management — all in one place.

---

## Status

**Pre-v1.0 — Developer preview.** Feature-complete for single-user internal use. A 6-week hardening + UI sprint is underway to reach production-ready v1.0. See [`Aziro_Ops_Priority_Roadmap.docx`](Aziro_Ops_Priority_Roadmap.docx) and [`Aziro_Ops_UI_Roadmap_Merged.docx`](Aziro_Ops_UI_Roadmap_Merged.docx) for the plan.

## Differentiators

Features where Aziro Ops leads other open-source DevOps tools (Lens, ArgoCD, Headlamp, Komodor, Grafana, Datadog, RunWhen, Portainer, Devtron, Kubecost):

- **Cmd+K Command Palette with live K8s resource search** — search targets, pages, and live pods/nodes/deployments in one palette
- **Multi-cloud unified sidebar** — Kubernetes, SSH, Docker, AWS, GCP, Azure, Terraform managed from a single rail
- **Inline `✦ AI` badges** on unhealthy resources — one-click diagnosis without opening chat
- **Two-model AI display** — tool calls and final answer stream as separate visible steps
- **Resource Topology SVG Graph** — Ingress → Service → Deployment → Pod network flow
- **Cloud auth pre-checks** in the AddTarget wizard — verifies CLI installed and authenticated before saving
- **Persistent log stream tray** — dev-tools console pattern, not a modal
- **SEV1/SEV2/SEV3** triage with snapshots captured at the moment the event fired

---

## Supported Targets

| Type | Connection | What you get |
|------|-----------|-------------|
| **Kubernetes** | kubectl context | Nodes, Pods, Deployments, Services, Ingress, Storage, Workloads, topology graph |
| **Server (SSH)** | SSH password or key | CPU, memory, disk, network, logs, services — Linux, Windows, Mac |
| **Local** | Auto-detected | Same as SSH — auto-registered when running on Linux |
| **Docker** | Local or remote daemon | Containers, images, networks, volumes, stats |
| **AWS** | CLI profile + region | EC2, S3, EKS, RDS, account info |
| **GCP** | Project ID | Compute, GKE, Storage, IAM |
| **Azure** | Subscription ID | VMs, AKS, Storage, Resource Groups |
| **Terraform** | Workspace directory | State, plan, outputs |

---

## Features

### Dashboard
- Tab-based resource explorer per target type
- **Kubernetes**: Nodes, Pods, Workloads, Services, Ingress, Storage, Network, Events tabs
- **SSH/Local**: Overview (CPU/memory/disk/uptime metrics), Logs, Network, Storage
- Click any resource → modal with Describe / Logs / Prev Logs / AI Analysis tabs
- Inline `✦ AI` badge on unhealthy pods — one-click diagnosis without opening chat

### AI Chat
- Target-scoped chat: ask about a specific cluster or server
- General sessions: persistent conversation history across sessions
- Streaming responses word-by-word (SSE), Markdown rendered with code highlighting
- Two-model architecture: fast model for tool calls, smart model for answers

### Monitoring & Alerts
- Background watcher streams Kubernetes events via `kubectl get events -w`
- Auto-triages to **SEV1** (critical), **SEV2** (warning), **SEV3** (info)
- Stores all incidents in SQLite with snapshots, AI diagnosis, and remediation
- Live Alerts page with SSE push — no polling needed

### Incident History
- Full incident log with AI diagnosis inline
- Filter by severity, status, or resource name
- Acknowledge / Resolve workflow
- Status persists across restarts

### Honest Gaps (being addressed in v1.0 sprint)

| Gap | Status |
|-----|--------|
| No authentication / multi-user | Flask-Login + RBAC landing in Week 1 |
| Flask dev server (single-process) | Gunicorn + nginx landing in Week 2 |
| SQLite write serialization | Postgres + Alembic landing in Week 3 |
| No real metric charts (current sparklines are decorative) | Recharts + Prometheus landing in Week 3 |
| No light theme (only dark variants) | Day / Night theme landing in Week 1 |
| No toast / notification feedback | Sonner toast system landing in Week 1 |
| No settings page | Settings page landing in Week 2 |
| No onboarding tour | react-joyride landing in Week 4 |
| Read-only resource views | Restart/Scale/Delete/Edit YAML landing in Week 2–4 |
| No WCAG accessibility baseline | Axe-core CI landing in Week 5 |

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

**Two-model architecture** — fast model for tool calls, smart model for final answers:

```bash
TOOL_MODEL=groq/llama-3.1-8b-instant ANSWER_MODEL=claude-haiku-4-5-20251001 python3 app.py
```

---

## Quick Start

```bash
# Install Python dependencies
pip install -r requirements.txt

# Copy the env template and fill in at least one AI provider key
cp .env.example .env
```

### Web mode (React dashboard)

```bash
# Local model (Ollama — free, private)
ollama pull llama3.1:8b
AI_MODEL=ollama/llama3.1:8b python3 app.py

# Or two-model setup (recommended — fast tool calls, smart final answers)
export GROQ_API_KEY="gsk_..."
export ANTHROPIC_API_KEY="sk-ant-..."
TOOL_MODEL=groq/llama-3.1-8b-instant ANSWER_MODEL=claude-haiku-4-5-20251001 python3 app.py
```

Open [http://localhost:5000](http://localhost:5000).

### CLI mode (terminal UI)

```bash
# Basic interactive CLI
python3 main.py

# Connect to a saved target by name
python3 main.py --target prod-k8s

# With background event monitoring
python3 main.py --target prod-k8s --monitor
```

### Frontend development

The React SPA is pre-built and committed to `frontend_dist/` — running `python3 app.py` serves it directly with no build step required. You only need Node.js if you're modifying the frontend.

```bash
cd frontend
npm install           # first time only
npm run dev           # Vite dev server on :5173, proxies /api to :5000
npm run build         # rebuild frontend_dist/ for production
npm run test          # Vitest unit tests
npm run test:e2e      # Playwright end-to-end tests
```

Requires Node.js 18+.

---

## Architecture

### Package Structure

```
devops-ai/
├── app.py                   ← Web server entry point (Flask)
├── main.py                  ← CLI entry point (TerminalUI + agent loop)
│
├── ui/
│   ├── web.py               ← Flask routes (thin, logic-free)
│   └── terminal.py          ← CLI TerminalUI (colored output, readline loop)
│
├── frontend/                ← React 18 + TypeScript + Vite SPA
│   └── src/
│       ├── pages/
│       │   ├── Home.tsx, Alerts.tsx, History.tsx, Chat.tsx
│       │   ├── Dashboard.tsx
│       │   └── dashboard/   ← primitives, tables, tabs (extracted modules)
│       ├── components/      ← Sidebar, CommandPalette, ResourceGraph,
│       │                       LogStream, ChatPanel, AIDrawer, AlertCard,
│       │                       AddTargetModal, LevelBadge, Markdown, ThemeContext
│       ├── hooks/           ← useChat, useSSE (exponential backoff)
│       └── api/client.ts    ← Typed API layer + SSE stream reader
│
├── agent/                   ← Agentic loop
│   ├── conversation.py      ← SSE streaming + tool loop (max 5 steps)
│   ├── manager.py           ← Per-target message history
│   └── needs_tools.py       ← Greeting vs infra heuristic
│
├── providers/
│   └── client.py            ← LiteLLM wrapper: chat(), chat_stream(),
│                              TOOL_MODEL / ANSWER_MODEL routing
│
├── tools/                   ← One file per target type
│   ├── executor.py          ← Routes command to correct tool, _run_many (max 8 workers)
│   ├── base.py              ← run_command(), 30s timeout, 3000 char truncation
│   ├── filter.py            ← is_destructive() — blocks dangerous commands
│   ├── ssh.py, kubectl.py, docker.py, local.py
│   └── aws.py, gcp.py, azure.py, terraform.py
│
├── monitor/                 ← Background event watcher
│   ├── watcher.py           ← kubectl get events -w stream
│   └── triage.py            ← SEV1 / SEV2 / SEV3 classifier
│
├── store/
│   └── db.py                ← SQLite: events, snapshots, analyses (with JOIN)
│
├── sessions/
│   └── manager.py           ← Chat sessions, persisted to chat_messages.json
│
├── targets/
│   ├── manager.py           ← Connection CRUD, credential masking
│   └── crypto.py            ← Fernet encryption for credentials at rest
│
├── sandbox/                 ← Execution isolation
│   ├── safe.py              ← Read-only command whitelist
│   ├── docker_sandbox.py    ← Container isolation
│   ├── executor.py          ← SANDBOX=safe|docker|local
│   └── redact.py            ← StreamRedactor — scrubs secrets from SSE streams
│
├── auth/                    ← (Scaffolding — Flask-Login landing in Week 1)
│
├── prompts/
│   ├── system_prompt.txt    ← Editable without code changes
│   └── builder.py           ← Injects live pod list at startup
│
└── tests/                   ← pytest suite (153 tests passing)
```

### Request Flow

```
Browser (React SPA)
       │
       │  HTTP / SSE
       ▼
ui/web.py  (Flask, thin routes)
       │
       ├─ /api/v1/targets          → targets/manager.py  (credential-masked)
       ├─ /api/v1/tab/<tid>/<tab>  → tools/executor.py   (_run_many, parallel)
       ├─ /api/v1/resource/<tid>   → tools/executor.py   (describe + logs)
       ├─ /api/v1/topology/<tid>   → kubectl → structured JSON (nodes/edges)
       ├─ /api/v1/logs/<tid>/stream→ subprocess.Popen kubectl logs -f (SSE)
       ├─ /api/v1/search/<tid>     → parallel kubectl grep (Cmd+K live search)
       ├─ /api/v1/chat/<tid>/stream→ agent/conversation.py (tool loop + stream)
       ├─ /api/v1/sessions/...     → sessions/manager.py (persistent history)
       ├─ /api/v1/monitor/stream   → monitor/watcher.py (SSE push)
       └─ /api/v1/events/...       → store/db.py (SQLite, JOIN with analyses)
```

### AI Agent Loop

```
User message
      │
      ▼
agent/needs_tools.py
      │
      ├─ greeting / general  ──▶  providers/chat_stream()  ──▶  SSE → browser
      │
      └─ infra question
              │
              └──▶  agent/conversation.py  (max 5 steps)
                          │
                          ├─ LLM [TOOL_MODEL] picks command
                          ├─ tools/executor.py runs on target
                          ├─ result fed back to LLM → repeat
                          └─ LLM [ANSWER_MODEL] streams final answer → browser
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_MODEL` | `ollama/llama3.1:8b` | Model for both tool calls and answers |
| `TOOL_MODEL` | — | Override model for tool calls only |
| `ANSWER_MODEL` | — | Override model for final answers only |
| `SANDBOX` | `safe` | Execution mode: `safe`, `docker`, or `local` |
| `PORT` | `5000` | Web server port |

---

## Requirements

- Python 3.8+
- `pip install -r requirements.txt`
- At least one AI provider (Ollama locally, or any cloud API key)
- CLI tools as needed: `kubectl`, `docker`, `aws`, `gcloud`, `az`, `terraform`
