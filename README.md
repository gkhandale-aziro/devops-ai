# Aziro Ops

AI-powered DevOps dashboard by Aziro that connects to your infrastructure and provides real-time monitoring, command execution, and AI-driven recommendations.

## Supported Targets

| Type | Connection | What you get |
|------|-----------|-------------|
| **Server (SSH)** | SSH (password or key) | CPU, memory, disk, network, logs, services — Linux, Windows, Mac |
| **Kubernetes** | kubectl context | Pods, nodes, deployments, services, network — click any resource for describe + AI analysis |
| **Docker** | Local or remote daemon | Containers, images, networks, volumes, stats |
| **AWS** | CLI profile + region | EC2, S3, EKS, RDS, account info |
| **GCP** | Project ID | Compute, GKE, Storage, IAM |
| **Azure** | Subscription ID | VMs, AKS, Storage, Resource Groups |
| **Terraform** | Workspace directory | State, plan, outputs |

## Features

- **Dashboard** — Grafana-style metrics for SSH servers (CPU, memory, disk, uptime)
- **K8s Lens-style** — Click any pod/node/deployment/service to see describe, logs, and AI recommendations
- **AI Chat** — Side panel + full-page chat with real-time streaming responses
- **100+ AI models** — Ollama, OpenAI, Claude, Gemini, Groq, Bedrock, and more via LiteLLM
- **Two-model architecture** — Fast model for tool calling, smart model for answers
- **Streaming** — Responses appear word-by-word like ChatGPT, not blank screen then wall of text
- **Auto-detect** — When deployed on Linux, auto-registers the host machine
- **Multi-target** — Manage multiple servers, clusters, and cloud accounts from one dashboard

## Supported AI Models

Aziro Ops uses **LiteLLM** and supports **100+ AI providers** — local or cloud. Just set an environment variable.

| Provider | Model example | API key env var |
|----------|--------------|-----------------|
| **Ollama** (local, free) | `ollama/llama3.1:8b` | — |
| **OpenAI** | `gpt-4o-mini`, `gpt-4o` | `OPENAI_API_KEY` |
| **Anthropic Claude** | `claude-haiku-4-5-20251001` | `ANTHROPIC_API_KEY` |
| **Google Gemini** | `gemini/gemini-2.0-flash` | `GEMINI_API_KEY` |
| **Groq** (fast, free tier) | `groq/llama-3.1-8b-instant` | `GROQ_API_KEY` |
| **AWS Bedrock** | `bedrock/anthropic.claude-3-haiku` | AWS credentials |
| **Azure OpenAI** | `azure/my-gpt4-deployment` | `AZURE_API_KEY` |
| **Mistral** | `mistral/mistral-large-latest` | `MISTRAL_API_KEY` |
| **Together AI** | `together_ai/meta-llama/Llama-3-8b` | `TOGETHERAI_API_KEY` |
| **Deepseek** | `deepseek/deepseek-chat` | `DEEPSEEK_API_KEY` |
| **Cohere** | `cohere/command-r-plus` | `COHERE_API_KEY` |

**Two-model architecture** (optional) — use a fast model for tool calls, a smarter model for final answers:

```bash
TOOL_MODEL=groq/llama-3.1-8b-instant ANSWER_MODEL=claude-haiku-4-5-20251001 python3 app.py
```

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Option 1: Local model (Ollama — free, private)
ollama pull llama3.1:8b
AI_MODEL=ollama/llama3.1:8b python3 app.py

# Option 2: Cloud model (faster, needs API key)
export OPENAI_API_KEY="sk-..."
AI_MODEL=gpt-4o-mini python3 app.py

# Option 3: Mix models (fast tool calls + smart answers)
export GROQ_API_KEY="gsk_..."
export ANTHROPIC_API_KEY="sk-ant-..."
TOOL_MODEL=groq/llama-3.1-8b-instant ANSWER_MODEL=claude-haiku-4-5-20251001 python3 app.py
```

Open [http://localhost:5000](http://localhost:5000) and add your first server.

## Architecture

### Package Structure

```
devops-ai/
├── app.py                  ← Flask routes only (thin entry point)
├── main.py                 ← CLI entry point
├── ui-dashboard.html       ← Full frontend (single-page app)
│
├── agent/                  ← Agentic loop (like kubectl-ai's pkg/agent)
│   ├── conversation.py     ← SSE streaming + tool loop (max 5 steps)
│   ├── manager.py          ← Per-target message history
│   ├── needs_tools.py      ← Greeting vs infra heuristic
│   └── tests/
│
├── providers/              ← LiteLLM wrapper (like kubectl-ai's gollm/)
│   ├── client.py           ← chat(), chat_stream(), TOOL_MODEL / ANSWER_MODEL
│   └── tests/
│
├── tools/                  ← One file per target type (like kubectl-ai's pkg/tools)
│   ├── executor.py         ← Routes command to correct tool by target type
│   ├── base.py             ← run_command(), 30s timeout, 3000 char truncation
│   ├── filter.py           ← is_destructive() — blocks dangerous commands
│   ├── ssh.py              ← paramiko, password + key auth, 1 retry
│   ├── kubectl.py          ← kubectl + context injection
│   ├── docker.py           ← docker + DOCKER_HOST
│   ├── aws.py              ← aws cli + profile/region
│   ├── gcp.py              ← gcloud + project
│   ├── azure.py            ← az cli + subscription
│   ├── terraform.py        ← terraform + workspace
│   ├── local.py            ← direct subprocess (no SSH)
│   └── tests/
│
├── sandbox/                ← Execution isolation (like kubectl-ai's pkg/sandbox)
│   ├── safe.py             ← Read-only command whitelist
│   ├── docker_sandbox.py   ← Container isolation
│   ├── executor.py         ← Dispatcher — SANDBOX=safe|docker|local
│   └── tests/
│
├── sessions/               ← Chat session persistence (like kubectl-ai's pkg/sessions)
│   ├── manager.py          ← CRUD, capped at 100 sessions, chat_sessions.json
│   └── tests/
│
├── targets/                ← Connection management
│   ├── manager.py          ← CRUD, targets.json
│   └── tests/
│
└── prompts/                ← System prompt
    ├── system_prompt.txt   ← Editable without touching code
    └── builder.py          ← Injects live pod list at startup
```

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Browser  (ui-dashboard.html)                      │
│                                                                      │
│  Dashboard · K8s View · Docker · Cloud · AI Chat · Resource Modal   │
└──────────────────────────────┬──────────────────────────────────────┘
                                │  HTTP / SSE (fetch + ReadableStream)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   app.py  (Flask routes only)                        │
│  /api/targets  /api/tab  /api/resource  /api/chat/<tid>/stream      │
│  /api/analyze/stream  /api/sessions  /api/sessions/<id>/chat/stream │
└────────┬──────────────┬──────────────┬──────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
  ┌────────────┐  ┌──────────────┐  ┌─────────────────────────────────┐
  │ targets/   │  │  sessions/   │  │           agent/                │
  │ manager.py │  │  manager.py  │  │                                 │
  │            │  │              │  │  needs_tools.py                 │
  │ targets    │  │  saved chat  │  │   ├─ greeting → direct stream   │
  │ .json      │  │  sessions    │  │   └─ infra   → tool loop        │
  └────────────┘  │  capped @100 │  │                                 │
                  │  .json       │  │  conversation.py (max 5 steps)  │
                  └──────────────┘  │   ├─ LLM picks command          │
                                     │   ├─ execute on target          │
                                     │   ├─ feed result back           │
                                     │   └─ stream final answer        │
                                     │                                 │
                                     │  manager.py                     │
                                     │   └─ per-target msg history     │
                                     └──────────────┬──────────────────┘
                                                    │
                             ┌──────────────────────┼──────────────────┐
                             ▼                      ▼                  ▼
                    ┌─────────────────┐  ┌───────────────┐  ┌──────────────┐
                    │   providers/    │  │    tools/     │  │  sandbox/    │
                    │   client.py     │  │               │  │              │
                    │                 │  │ executor.py   │  │ safe.py      │
                    │  chat()         │  │  ├─ ssh.py    │  │ (whitelist)  │
                    │  chat_stream()  │  │  ├─ kubectl   │  │              │
                    │                 │  │  ├─ docker    │  │ docker_sand  │
                    │  TOOL_MODEL     │  │  ├─ aws       │  │ box.py       │
                    │  ANSWER_MODEL   │  │  ├─ gcp       │  │              │
                    │                 │  │  ├─ azure     │  │ executor.py  │
                    │  LiteLLM        │  │  ├─ terraform │  │ SANDBOX env  │
                    │  100+ providers │  │  └─ local     │  └──────────────┘
                    │                 │  │               │
                    │  Ollama         │  │ base.py       │  ┌──────────────┐
                    │  OpenAI         │  │ filter.py     │  │  prompts/    │
                    │  Claude         │  │               │  │              │
                    │  Gemini         │  │ _run_many()   │  │ system_      │
                    │  Groq           │  │ parallel      │  │ prompt.txt   │
                    │  Bedrock + more │  │ max 8 workers │  │ builder.py   │
                    └─────────────────┘  └──────┬────────┘  └──────────────┘
                                                 │
                                                 ▼
                                    ┌────────────────────────┐
                                    │      Your Infra         │
                                    │  Server (SSH)           │
                                    │  Kubernetes             │
                                    │  Docker                 │
                                    │  AWS / GCP / Azure      │
                                    │  Terraform              │
                                    └────────────────────────┘
```

### Data Flow

```
User message (browser)
      │
      ▼
agent/needs_tools.py:
  ├─ greeting / general  →  providers/chat_stream() — SSE, no commands
  │
  └─ infra question      →  agent/conversation.py agentic loop:
          │
          ├─ providers/chat() [TOOL_MODEL] — LLM picks a command
          ├─ tools/execute_on_target() — ssh / kubectl / docker / aws / gcp / azure / terraform
          │     _run_many() — parallel execution, max 8 workers
          ├─ output fed back to LLM, repeat (max 5 steps)
          └─ providers/chat_stream() [ANSWER_MODEL]
                → SSE stream tokens word-by-word to browser
                → browser shows collapsible "Ran X commands" pill
                → sessions/manager.py saves to chat_sessions.json
```
│   ├── filter.py           ← is_destructive() check
│   └── tests/
│
├── sandbox/                ← Execution isolation
│   ├── safe.py             ← Read-only command whitelist
│   ├── docker_sandbox.py   ← Container isolation
│   ├── executor.py         ← SANDBOX env dispatcher
│   └── tests/
│
├── sessions/               ← Chat session persistence
│   ├── manager.py          ← CRUD, capped at 100 sessions
│   └── tests/
│
├── targets/                ← Connection management
│   ├── manager.py          ← CRUD, targets.json
│   └── tests/
│
└── prompts/                ← System prompt
    ├── system_prompt.txt   ← Editable without touching code
    └── builder.py          ← Injects live pod list
```

## CLI Mode

For terminal-only usage without the web dashboard:

```bash
python main.py
```

## Requirements

- Python 3.8+
- Ollama (or any LiteLLM-compatible provider)
- SSH access to target servers (paramiko)
- kubectl, docker, aws, gcloud, az, terraform CLIs as needed
