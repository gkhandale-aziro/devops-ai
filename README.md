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

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Browser  (ui-dashboard.html)                     │
│                                                                           │
│  ┌──────────────────┐   ┌───────────────────┐   ┌─────────────────────┐ │
│  │   Dashboard       │   │   AI Chat          │   │   Resource Modal    │ │
│  │  · Overview       │   │  · Session list    │   │  · Describe         │ │
│  │  · Kubernetes     │   │  · Saved history   │   │  · Logs             │ │
│  │  · Logs           │   │  · Streaming       │   │  · AI Analysis      │ │
│  │  · Network        │   │    responses       │   │                     │ │
│  │  · Storage        │   └───────────────────┘   └─────────────────────┘ │
│  └──────────────────┘                                                     │
└────────────────────────────────────┬─────────────────────────────────────┘
                                      │  HTTP / SSE (fetch + ReadableStream)
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        app.py  (Flask routes only)                        │
│                                                                           │
│   /api/targets    /api/tab    /api/resource    /api/sessions              │
│   /api/chat/<tid>/stream      /api/analyze/stream                        │
│   /api/sessions/<id>/chat/stream                                         │
└───────┬────────────────┬──────────────────┬──────────────────────────────┘
        │                │                  │
        ▼                ▼                  ▼
┌─────────────┐  ┌───────────────┐  ┌──────────────────────────────────────┐
│  targets/   │  │   sessions/   │  │             agent/                   │
│             │  │               │  │                                      │
│  manager.py │  │  manager.py   │  │  needs_tools.py  — greeting vs infra │
│  CRUD for   │  │  ChatGPT-style│  │  manager.py      — per-target state  │
│  targets    │  │  sessions     │  │  conversation.py — agentic loop      │
│  .json      │  │  capped @100  │  │                                      │
└─────────────┘  └───────────────┘  │  1. needs_tools() decides path       │
                                     │  2. greeting → direct stream         │
                                     │  3. infra → tool loop (max 5 steps)  │
                                     └──────────────┬───────────────────────┘
                                                    │
                              ┌─────────────────────┼──────────────────────┐
                              ▼                     ▼                      ▼
                     ┌─────────────────┐  ┌──────────────┐   ┌────────────────┐
                     │   providers/    │  │    tools/    │   │   sandbox/     │
                     │                 │  │              │   │                │
                     │  client.py      │  │  executor.py │   │  safe.py       │
                     │  chat()         │  │  ssh.py      │   │  (whitelist)   │
                     │  chat_stream()  │  │  kubectl.py  │   │  docker_sand-  │
                     │                 │  │  docker.py   │   │  box.py        │
                     │  TOOL_MODEL     │  │  aws.py      │   │  executor.py   │
                     │  ANSWER_MODEL   │  │  gcp.py      │   │  (SANDBOX env) │
                     │                 │  │  azure.py    │   └────────────────┘
                     │  100+ via       │  │  terraform.py│
                     │  LiteLLM        │  │  local.py    │   ┌────────────────┐
                     │                 │  │  base.py     │   │   prompts/     │
                     │  Ollama         │  │  filter.py   │   │                │
                     │  OpenAI         │  │              │   │  system_prompt │
                     │  Claude         │  │  _run_many() │   │    .txt        │
                     │  Gemini         │  │  parallel    │   │  builder.py    │
                     │  Groq           │  │  max 8 tasks │   └────────────────┘
                     │  Bedrock + more │  └──────┬───────┘
                     └─────────────────┘         │
                                                  ▼
                                       ┌─────────────────────┐
                                       │    Your Infra        │
                                       │                      │
                                       │  Server (SSH)        │
                                       │  Kubernetes          │
                                       │  Docker              │
                                       │  AWS / GCP / Azure   │
                                       │  Terraform           │
                                       └─────────────────────┘
```

### Data Flow

```
User message (browser)
      │
      ▼
agent/needs_tools.py decides:
  ├─ greeting / general question
  │      └─→ providers/chat_stream() — direct SSE stream, no commands
  │
  └─ infra question (pod, disk, deploy, status, logs ...)
         └─→ agent/conversation.py agentic loop (max 5 steps):
                  │
                  ├─ providers/chat() with TOOL_MODEL
                  │       LLM picks a command to run
                  ├─ tools/execute_on_target()
                  │       routes to ssh / kubectl / docker / aws / gcp / azure / terraform
                  │       _run_many() runs tab commands in parallel (max 8 workers)
                  ├─ output fed back to LLM
                  └─ providers/chat_stream() with ANSWER_MODEL
                          streams final answer word-by-word via SSE
                          → browser renders with collapsible "Ran X commands" pill
                          → sessions/manager.py saves to chat_sessions.json
```

### Package Structure

```
devops-ai/
├── app.py                  ← Flask routes only
├── main.py                 ← CLI entry point
├── ui-dashboard.html       ← Full frontend (single-page app)
│
├── agent/                  ← Agentic loop
│   ├── conversation.py     ← SSE streaming + tool loop
│   ├── manager.py          ← Per-target message history
│   ├── needs_tools.py      ← Greeting vs infra heuristic
│   └── tests/
│
├── providers/              ← LiteLLM wrapper
│   ├── client.py           ← chat(), chat_stream(), two-model setup
│   └── tests/
│
├── tools/                  ← One file per target type
│   ├── executor.py         ← Routes by target type
│   ├── ssh.py / kubectl.py / docker.py
│   ├── aws.py / gcp.py / azure.py / terraform.py / local.py
│   ├── base.py             ← run_command(), timeout, truncation
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
