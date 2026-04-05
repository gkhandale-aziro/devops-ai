# Aziro Ops

> AI-powered DevOps command center — monitor, inspect, and fix your infrastructure with natural language.

Aziro Ops connects to your servers, Kubernetes clusters, and cloud accounts and gives you a professional dashboard with real-time monitoring, agentic AI chat, and intelligent incident management — all in one place.

---

## What's New

- **Cmd+K Command Palette** — search targets, pages, and K8s resources instantly
- **Resource Topology Graph** — visual map of Ingress → Service → Deployment → Pod relationships
- **Inline AI Badges** — click `✦ AI` on any unhealthy pod for an instant one-line diagnosis
- **Live Log Streaming** — real-time `kubectl logs -f` tray, filter + pause + auto-scroll
- **Theme Switcher** — Indigo (default), Tron (cyan), Sapphire (blue) — persisted per browser
- **OLED Dark Mode** — redesigned with Plus Jakarta Sans, sparkline charts, skeleton loaders
- **SEV1/SEV2/SEV3** severity system with persistent incident history and AI diagnosis
- **K8s Workloads/Ingress/Storage tabs** — full Kubernetes resource coverage beyond pods/nodes
- **Collapsible resource cards** — every section is expandable/collapsible
- **Markdown AI responses** — formatted code blocks, headers, and lists in chat

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

### Competitive Features (Devtron/Lens/Grafana parity)
| Feature | Inspired by |
|---------|-------------|
| Cmd+K palette with live K8s search | VS Code / Linear |
| Resource topology SVG graph | ArgoCD resource tree |
| Inline AI on unhealthy resources | Datadog Bits AI |
| Live log streaming tray | Lens bottom tray |
| Theme switcher | Grafana themes |

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

# Option 1: Local model (Ollama — free, private)
ollama pull llama3.1:8b
AI_MODEL=ollama/llama3.1:8b python3 app.py

# Option 2: Cloud model
export GEMINI_API_KEY="..."
AI_MODEL=gemini/gemini-2.0-flash python3 app.py

# Option 3: Two-model setup (recommended for best performance)
export GROQ_API_KEY="gsk_..."
export ANTHROPIC_API_KEY="sk-ant-..."
TOOL_MODEL=groq/llama-3.1-8b-instant ANSWER_MODEL=claude-haiku-4-5-20251001 python3 app.py
```

Open [http://localhost:5000](http://localhost:5000) and add your first connection.

---

## Architecture

### Package Structure

```
devops-ai/
├── app.py                   ← Entry point
├── ui/
│   └── web.py               ← Flask routes (thin, logic-free)
│
├── frontend/                ← React 18 + TypeScript + Vite SPA
│   └── src/
│       ├── pages/           ← Home, Dashboard, Alerts, History, Chat
│       ├── components/      ← Sidebar, CommandPalette, ResourceGraph,
│       │                       LogStream, ChatPanel, AIDrawer, ThemeContext
│       ├── hooks/           ← useChat, useSSE (exponential backoff)
│       └── api/client.ts    ← Typed API layer + SSE stream reader
│
├── agent/                   ← Agentic loop
│   ├── conversation.py      ← SSE streaming + tool loop (max 5 steps)
│   ├── manager.py           ← Per-target message history
│   └── needs_tools.py       ← Greeting vs infra heuristic
│
├── providers/               ← LiteLLM wrapper
│   └── client.py            ← chat(), chat_stream(), TOOL_MODEL / ANSWER_MODEL
│
├── tools/                   ← One file per target type
│   ├── executor.py          ← Routes command to correct tool
│   ├── base.py              ← run_command(), 30s timeout, 3000 char truncation
│   ├── filter.py            ← is_destructive() — blocks dangerous commands
│   ├── ssh.py, kubectl.py, docker.py
│   ├── aws.py, gcp.py, azure.py, terraform.py, local.py
│   └── _run_many()          ← parallel execution, max 8 workers
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
│   └── manager.py           ← Connection CRUD, credential masking
│
├── sandbox/                 ← Execution isolation
│   ├── safe.py              ← Read-only command whitelist
│   ├── docker_sandbox.py    ← Container isolation
│   └── executor.py          ← SANDBOX=safe|docker|local
│
└── prompts/
    ├── system_prompt.txt    ← Editable without code changes
    └── builder.py           ← Injects live pod list at startup
```

### Request Flow

```
Browser (React SPA)
       │
       │  HTTP / SSE
       ▼
ui/web.py  (Flask, thin routes)
       │
       ├─ /api/targets          → targets/manager.py  (credential-masked)
       ├─ /api/tab/<tid>/<tab>  → tools/executor.py   (_run_many, parallel)
       ├─ /api/resource/<tid>   → tools/executor.py   (describe + logs)
       ├─ /api/topology/<tid>   → kubectl → structured JSON (nodes/edges)
       ├─ /api/logs/<tid>/stream→ subprocess.Popen kubectl logs -f (SSE)
       ├─ /api/search/<tid>     → parallel kubectl grep (Cmd+K live search)
       ├─ /api/chat/<tid>/stream→ agent/conversation.py (tool loop + stream)
       ├─ /api/sessions/...     → sessions/manager.py (persistent history)
       ├─ /api/monitor/stream   → monitor/watcher.py (SSE push)
       └─ /api/events/...       → store/db.py (SQLite, JOIN with analyses)
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
