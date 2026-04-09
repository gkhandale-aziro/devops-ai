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

### 1. Install

```bash
# Clone and install
git clone https://github.com/your-org/aziro-ops.git
cd aziro-ops
pip install -r requirements.txt

# Copy the env template
cp .env.example .env
```

### 2. Configure AI model

Aziro Ops needs an AI backend. Pick **one** option:

#### Option A — Ollama (local, free, private)

```bash
# Install Ollama: https://ollama.com/download
ollama pull llama3.1:8b
# No API key needed — runs entirely on your machine
```

#### Option B — Cloud API key

Add your key to `.env`:

```bash
# OpenAI
OPENAI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini

# Or Anthropic
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-haiku-4-5-20251001

# Or Google Gemini
GEMINI_API_KEY=...
AI_MODEL=gemini/gemini-2.0-flash

# Or Groq (free tier available)
GROQ_API_KEY=gsk_...
AI_MODEL=groq/llama-3.1-8b-instant
```

#### Option C — Two-model setup (recommended for best results)

Use a fast model for tool calls and a smarter model for final answers:

```bash
TOOL_MODEL=groq/llama-3.1-8b-instant
ANSWER_MODEL=claude-haiku-4-5-20251001
```

See [Recommended Ollama Models](#recommended-ollama-models) for local model choices.

### 3. Configure API authentication

Set `AZIRO_API_KEY` to secure all `/api/` endpoints with Bearer token auth. When unset, auth is disabled (acceptable for local development only).

```bash
# Generate a secure key
export AZIRO_API_KEY=$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')

# Or add to .env for persistence
echo "AZIRO_API_KEY=$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')" >> .env
```

The frontend sends this automatically. For direct API calls, pass it as a Bearer token:

```bash
curl -H "Authorization: Bearer <your-key>" http://localhost:5000/api/v1/targets
```

> **Warning:** Without `AZIRO_API_KEY`, every `/api/` route is open to anyone who can reach the server. Always set it before exposing Aziro Ops to any network.

### 4. Run

#### Web mode (React dashboard)

```bash
python3 app.py
# → http://localhost:5000
```

#### CLI mode (terminal UI)

```bash
python3 main.py
python3 main.py --target prod-k8s
python3 main.py --target prod-k8s --monitor
```

### 5. Frontend development

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

## Docker

### Requirements

The Docker image includes:

| Component | Size impact | Why |
| --------- | ----------- | --- |
| `python:3.12-slim` | ~150 MB | Base runtime |
| `pip` dependencies (Flask, LiteLLM, Paramiko, Cryptography) | ~120 MB | Backend |
| `kubectl` | ~50 MB | Kubernetes target support |
| `openssh-client` | ~5 MB | SSH target support |
| `curl` | ~5 MB | Healthcheck |
| Pre-built React SPA (`frontend_dist/`) | ~2 MB | Frontend |
| **Total image size** | **~330 MB** | |

The image does **not** include: Node.js, frontend source, tests, or Ollama. If using Ollama, run it separately on the host or as a sidecar container.

### Build and run

```bash
# Build
docker build -t aziro-ops .

# Run (minimal)
docker run -d --name aziro-ops \
  -p 5000:5000 \
  -v aziro-data:/app/data \
  --env-file .env \
  aziro-ops

# Run with cloud credentials (optional — mount what you need)
docker run -d --name aziro-ops \
  -p 5000:5000 \
  -v aziro-data:/app/data \
  -v ~/.kube:/home/aziro/.kube:ro \
  -v ~/.aws:/home/aziro/.aws:ro \
  -v ~/.config/gcloud:/home/aziro/.config/gcloud:ro \
  --env-file .env \
  aziro-ops
```

### Using with Ollama

Ollama runs outside the container. Connect them via host networking:

```bash
# Start Ollama on the host
ollama serve

# Run Aziro Ops with access to host network
docker run -d --name aziro-ops \
  -p 5000:5000 \
  -v aziro-data:/app/data \
  --env-file .env \
  -e OLLAMA_API_BASE=http://host.docker.internal:11434 \
  aziro-ops
```

On Linux, use `--add-host=host.docker.internal:host-gateway` if `host.docker.internal` doesn't resolve.

### Docker Compose

```bash
docker compose up --build
```

See [`docker-compose.yml`](docker-compose.yml) for the full configuration.

### Persistent data

All state is stored in the `/app/data` volume:

| File | Contents |
| ---- | -------- |
| `.aziro_key` | Fernet encryption key for credentials |
| `targets.json` | Encrypted target configurations |
| `chat_sessions.json` | Chat session metadata |
| `chat_messages.json` | Chat message history |
| `aziro.db` | SQLite event store (incidents, snapshots, AI analyses) |

> **Backup:** `docker run --rm -v aziro-data:/data -v $(pwd):/backup alpine tar czf /backup/aziro-backup.tar.gz /data`

---

## Recommended Ollama Models

All models run locally via [Ollama](https://ollama.com) — no API key, no data leaves your machine.

### Best for Aziro Ops

| Model | Size | VRAM | Best for | Install |
| ----- | ---- | ---- | -------- | ------- |
| **`llama3.1:8b`** | 4.7 GB | 6 GB | Default all-rounder — good tool calling + answers | `ollama pull llama3.1:8b` |
| **`qwen2.5:7b`** | 4.4 GB | 6 GB | Strong tool calling, fast on modest hardware | `ollama pull qwen2.5:7b` |
| **`mistral:7b`** | 4.1 GB | 6 GB | Fast, concise answers — good as TOOL_MODEL | `ollama pull mistral:7b` |
| **`gemma3:4b`** | 3.3 GB | 4 GB | Lightweight — works on laptops with 8 GB RAM | `ollama pull gemma3:4b` |
| **`llama3.1:70b`** | 40 GB | 48 GB | Best local quality — needs serious GPU | `ollama pull llama3.1:70b` |
| **`deepseek-r1:8b`** | 4.9 GB | 6 GB | Strong reasoning for complex diagnosis | `ollama pull deepseek-r1:8b` |

### Recommended two-model setups (local)

```bash
# Budget (8 GB RAM) — single model
AI_MODEL=ollama/gemma3:4b

# Standard (16 GB RAM) — fast tool calls, solid answers
TOOL_MODEL=ollama/mistral:7b
ANSWER_MODEL=ollama/llama3.1:8b

# Power (24+ GB RAM) — best local quality
TOOL_MODEL=ollama/qwen2.5:7b
ANSWER_MODEL=ollama/llama3.1:70b
```

### Hybrid: local tool calls + cloud answers

Best cost-to-quality ratio — tool calls stay local (free), only final answers hit the API:

```bash
TOOL_MODEL=ollama/qwen2.5:7b
ANSWER_MODEL=claude-haiku-4-5-20251001  # or gpt-4o-mini, gemini/gemini-2.0-flash
```

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

## System Requirements

- Python 3.8+
- `pip install -r requirements.txt`
- At least one AI provider (Ollama locally, or any cloud API key)
- CLI tools as needed: `kubectl`, `docker`, `aws`, `gcloud`, `az`, `terraform`
