# DevOps AI Dashboard

AI-powered DevOps dashboard that connects to your infrastructure and provides real-time monitoring, command execution, and AI-driven recommendations.

## Supported Targets

| Type | Connection | What you get |
|------|-----------|-------------|
| **Linux Server** | SSH (password or key) | CPU, memory, disk, network, logs, services |
| **Kubernetes** | kubectl context | Pods, nodes, deployments, services, network — click any resource for describe + AI analysis |
| **Docker** | Local or remote daemon | Containers, images, networks, volumes, stats |
| **AWS** | CLI profile + region | EC2, S3, EKS, RDS, account info |
| **GCP** | Project ID | Compute, GKE, Storage, IAM |
| **Azure** | Subscription ID | VMs, AKS, Storage, Resource Groups |
| **Terraform** | Workspace directory | State, plan, outputs |

## Features

- **Dashboard** — Grafana-style metrics for SSH servers (CPU, memory, disk, uptime)
- **K8s Lens-style** — Click any pod/node/deployment/service to see describe, logs, and AI recommendations
- **AI Chat** — Side panel + full-page chat, ask anything about your connected infrastructure
- **Two-model architecture** — Fast model for tool calling, smart model for answers
- **Auto-detect** — When deployed on Linux, auto-registers the host machine
- **Multi-target** — Manage multiple servers, clusters, and cloud accounts from one dashboard

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Set your AI model (uses Ollama by default)
export AI_MODEL="ollama/llama3.1:8b"

# Optional: use different models for tool calls vs answers
export TOOL_MODEL="ollama/llama3.1:8b"
export ANSWER_MODEL="ollama/gemma3:latest"

# Run the dashboard
python app.py
```

Open [http://localhost:5000](http://localhost:5000) and add your first server.

## Architecture

```
Browser (ui-dashboard.html)
    |
Flask API (app.py)
    |
    ├── targets.py      — Connection CRUD (persisted to targets.json)
    ├── executors.py     — SSH, kubectl, docker, cloud CLI execution
    ├── providers.py     — LiteLLM two-model AI integration
    └── prompts.py       — AI system prompt
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
