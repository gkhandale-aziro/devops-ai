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
                                      │  HTTP / SSE (streaming)
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           Flask API  (app.py)                             │
│                                                                           │
│   /api/targets    /api/tab    /api/resource    /api/sessions              │
│   /api/chat       /api/analyze                /api/sessions/<id>/chat    │
└──────────┬───────────────────────┬────────────────────────┬──────────────┘
           │                       │                        │
           ▼                       ▼                        ▼
┌────────────────┐      ┌─────────────────────┐   ┌─────────────────────┐
│  targets.py    │      │    executors.py      │   │    providers.py     │
│                │      │                      │   │                     │
│  Connection    │      │  SSH  (paramiko)     │   │  LiteLLM            │
│  CRUD          │      │  kubectl             │   │                     │
│                │      │  docker              │   │  TOOL_MODEL         │
│  targets.json  │      │  aws cli             │   │  ├─ Ollama          │
│  chat_sessions │      │  gcloud              │   │  ├─ OpenAI          │
│    .json       │      │  az cli              │   │  ├─ Claude          │
│                │      │  terraform           │   │  ├─ Gemini          │
│                │      │  local shell         │   │  ├─ Groq            │
└────────────────┘      └──────────┬──────────┘   │  └─ Bedrock / more  │
                                    │               │                     │
                                    ▼               │  ANSWER_MODEL       │
                         ┌──────────────────┐       │  (optional)         │
                         │  Your Infra      │       └─────────────────────┘
                         │                  │
                         │  · Linux / Win   │
                         │  · Kubernetes    │
                         │  · Docker        │
                         │  · AWS / GCP     │
                         │  · Azure         │
                         │  · Terraform     │
                         └──────────────────┘
```

### Data Flow

```
User message
      │
      ▼
General question? (hi, what is X, explain Y)
  ├─ YES ─→ /api/sessions/<id>/chat/stream
  │              └─→ LiteLLM (no tools) ─→ stream tokens to browser
  │
  └─ NO  ─→ /api/chat/<target>/stream
                 │
                 └─→ Agentic loop (max 5 steps)
                          │
                          ├─ TOOL_MODEL picks a command to run
                          ├─ executors.py runs it on the target
                          ├─ Output fed back to model
                          └─ ANSWER_MODEL writes final answer ─→ stream to browser
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
