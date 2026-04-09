# Aziro Ops — Setup & Connection Guide

Complete reference for running Aziro Ops locally (`python3 app.py`) or via Docker, adding infrastructure targets, and configuring AI models.

---

## Table of Contents

- [1. Running Modes](#1-running-modes)
- [2. AI Model Setup](#2-ai-model-setup)
- [3. API Authentication](#3-api-authentication)
- [4. Adding Targets](#4-adding-targets)
- [5. Data & Persistence](#5-data--persistence)
- [6. Docker Reference](#6-docker-reference)
- [7. Troubleshooting](#7-troubleshooting)

---

## 1. Running Modes

### Local (python3 app.py)

Everything runs on your machine. Data files live in the project root.

```bash
pip install -r requirements.txt
cp .env.example .env         # edit with your AI provider key
python3 app.py               # → http://localhost:5000
```

### Docker

App runs in a container. Persistent data on a Docker volume. Cloud CLIs baked into the image via multi-stage build.

```bash
docker build -t aziro-ops .
docker run -d --name aziro-ops \
  -p 5000:5000 \
  -v aziro-data:/app/data \
  --env-file .env \
  aziro-ops
```

### Key differences

| Aspect | Local | Docker |
| ------ | ----- | ------ |
| Data location | Project root (`./targets.json`, `./aziro.db`) | `/app/data/` volume |
| Cloud CLIs | Use your system installs | Baked into image (kubectl, aws, gcloud, az, terraform, helm, docker) |
| Kubeconfig | `~/.kube/config` | Must mount: `-v ~/.kube:/root/.kube:ro` |
| Cloud creds | `~/.aws`, `~/.config/gcloud`, `~/.azure` | Must mount read-only (see [Docker Reference](#6-docker-reference)) |
| SSH keys | `~/.ssh/` | Must mount: `-v ~/.ssh:/root/.ssh:ro` |
| Ollama | Reaches `localhost:11434` directly | Needs `OLLAMA_API_BASE=http://host.docker.internal:11434` |

---

## 2. AI Model Setup

Aziro Ops uses [LiteLLM](https://docs.litellm.ai/) to support 100+ AI providers. Configuration is via environment variables (`.env` file or command line).

### Environment variables

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AI_MODEL` | `ollama/llama3.1:8b` | Single model for both tool calls and answers |
| `TOOL_MODEL` | (falls back to `AI_MODEL`) | Fast model for deciding which commands to run |
| `ANSWER_MODEL` | (falls back to `TOOL_MODEL`) | Smart model for writing the final analysis |

### How the two-model architecture works

```
User question
      │
      ▼
TOOL_MODEL (fast, cheap)
  → picks shell command (e.g., "kubectl get pods -A")
  → command runs on target
  → output fed back to TOOL_MODEL
  → repeat up to 5 steps
      │
      ▼
ANSWER_MODEL (smart)
  → reads all command outputs
  → streams final diagnosis to browser
```

Both models are visible in the UI as separate steps.

### Provider setup

#### Ollama (local, free, private)

```bash
# Install: https://ollama.com/download
ollama serve                      # start the server
ollama pull llama3.1:8b           # download the model

# .env
AI_MODEL=ollama/llama3.1:8b
# No API key needed
```

**In Docker:** Ollama runs on the host, not in the container.

```bash
# .env
AI_MODEL=ollama/llama3.1:8b
OLLAMA_API_BASE=http://host.docker.internal:11434

# Linux: add --add-host=host.docker.internal:host-gateway to docker run
```

**Startup check (CLI only):** `main.py` verifies Ollama is running and the model is downloaded before starting. Web mode (`app.py`) does not — errors appear on first query.

#### OpenAI

```bash
# .env
OPENAI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini          # or gpt-4o, gpt-4-turbo
```

#### Anthropic Claude

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-haiku-4-5-20251001   # or claude-sonnet-4-6, claude-opus-4-6
```

#### Google Gemini

```bash
# .env
GEMINI_API_KEY=...
AI_MODEL=gemini/gemini-2.0-flash
```

#### Groq (free tier available)

```bash
# .env
GROQ_API_KEY=gsk_...
AI_MODEL=groq/llama-3.1-8b-instant
```

#### AWS Bedrock

```bash
# .env
AWS_PROFILE=default
AWS_DEFAULT_REGION=us-east-1
AI_MODEL=bedrock/anthropic.claude-3-haiku
```

#### Azure OpenAI

```bash
# .env
AZURE_API_KEY=...
AZURE_API_BASE=https://your-resource.openai.azure.com/
AZURE_API_VERSION=2024-02-01
AI_MODEL=azure/my-gpt4-deployment
```

### Recommended two-model setups

```bash
# Budget — local only (8 GB RAM)
AI_MODEL=ollama/gemma3:4b

# Standard — local only (16 GB RAM)
TOOL_MODEL=ollama/mistral:7b
ANSWER_MODEL=ollama/llama3.1:8b

# Hybrid — local tool calls, cloud answers (best cost/quality)
TOOL_MODEL=ollama/qwen2.5:7b
ANSWER_MODEL=claude-haiku-4-5-20251001

# Cloud — fast + smart
TOOL_MODEL=groq/llama-3.1-8b-instant
ANSWER_MODEL=gpt-4o-mini
```

### Error handling

LLM calls retry 4 times with backoff (0s → 10s → 20s → 60s). If all fail:

- **CLI:** Error message printed, loop continues.
- **Web:** SSE error event sent to browser, request ends.

---

## 3. API Authentication

Set `AZIRO_API_KEY` to secure all `/api/` routes with Bearer token auth.

```bash
# Generate a key
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# Add to .env
AZIRO_API_KEY=<generated-key>
```

- **When set:** Every `/api/` request must include `Authorization: Bearer <key>`. The frontend reads the key from a `<script>` tag injected into `index.html` by the backend.
- **When unset:** Auth is disabled (dev mode). A warning is printed on startup.
- **Direct API calls:** `curl -H "Authorization: Bearer <key>" http://localhost:5000/api/v1/targets`

---

## 4. Adding Targets

### Kubernetes

#### Local kubeconfig (kind, minikube, Docker Desktop)

| Field | Value | Notes |
| ----- | ----- | ----- |
| Name | `my-cluster` | Display name |
| Type | `kubernetes` | |
| Context | `kind-kubectl-ai` | From `kubectl config get-contexts` |

**Docker:** Mount kubeconfig: `-v ~/.kube:/root/.kube:ro`

Local clusters (kind, minikube) listen on `127.0.0.1` which is unreachable from Docker. Use `--network host` or `--add-host=host.docker.internal:host-gateway` and edit kubeconfig to replace `127.0.0.1` with `host.docker.internal`.

#### Amazon EKS

| Field | Value | Notes |
| ----- | ----- | ----- |
| Name | `prod-eks` | Display name |
| Type | `kubernetes` | |
| Provider | `eks` | Triggers AWS auth flow |
| Cluster | `k8-cluster` | EKS cluster name |
| Region | `us-east-1` | AWS region |
| Profile | `default` | Optional — AWS CLI profile name |

**Auth flow:** App runs `aws eks update-kubeconfig` to configure kubectl, then `aws sts get-caller-identity` to verify.

**Local:** Needs `aws` CLI installed + configured (`aws configure` or `~/.aws/credentials`).

**Docker:** Mount AWS creds: `-v ~/.aws:/root/.aws:ro`. The `aws` CLI is baked into the image.

#### Google GKE

| Field | Value | Notes |
| ----- | ----- | ----- |
| Name | `prod-gke` | Display name |
| Type | `kubernetes` | |
| Provider | `gke` | Triggers GCP auth flow |
| Cluster | `my-cluster` | GKE cluster name |
| Project | `my-project-id` | GCP project ID |
| Zone | `us-central1-a` | Or Region: `us-central1` |
| Service Account Key File | `/path/to/key.json` | Optional — for service account auth |

**Auth flow:** App runs `gcloud container clusters get-credentials`.

**Local:** Needs `gcloud` CLI + `gcloud auth login`.

**Docker:** Mount gcloud tokens: `-v ~/.config/gcloud:/root/.config/gcloud:ro`. Or mount service account JSON and set its path in config.

#### Azure AKS

| Field | Value | Notes |
| ----- | ----- | ----- |
| Name | `prod-aks` | Display name |
| Type | `kubernetes` | |
| Provider | `aks` | Triggers Azure auth flow |
| Cluster | `my-aks` | AKS cluster name |
| Resource Group | `my-rg` | Azure resource group |
| Subscription | `sub-id` | Optional — Azure subscription ID |

**Auth flow:** App runs `az aks get-credentials`.

**Local:** Needs `az` CLI + `az login` (interactive browser).

**Docker:** Mount Azure tokens: `-v ~/.azure:/root/.azure:ro`. For headless Docker, use service principal: `az login --service-principal`.

---

### SSH (Linux/Windows/Mac servers)

| Field | Value | Notes |
| ----- | ----- | ----- |
| Name | `prod-server` | Display name |
| Type | `ssh` | |
| Host | `192.168.1.50` | IP or hostname |
| Port | `22` | Default: 22 |
| User | `ubuntu` | SSH username |
| Password | `***` | For password auth |
| Private Key | (paste key content) | For key-based auth |
| Key Passphrase | `***` | If key is encrypted |

**Auth priority:**
1. If `password` set → password auth
2. If `private_key` set → key auth (with optional passphrase)
3. Otherwise → auto-discover keys from `~/.ssh/`

**Local:** Works directly.

**Docker:**
- Password auth: Works without any mounts.
- Key auth: Mount SSH keys: `-v ~/.ssh:/root/.ssh:ro`
- If `key_path` points to a host file, it won't exist inside the container.

**Connection:** Uses Paramiko (Python SSH library), not the `ssh` CLI binary. 10s connection timeout, 30s command timeout.

---

### Docker (containers, images, volumes)

| Field | Value | Notes |
| ----- | ----- | ----- |
| Name | `local-docker` | Display name |
| Type | `docker` | |
| Host | (empty for local) | `tcp://remote:2375` for remote daemon |
| TLS Verify | `1` | Optional — enable TLS for remote |
| Cert Path | `/path/to/certs` | Optional — TLS certificate directory |

**Local:** Uses `/var/run/docker.sock` (no auth needed).

**Docker:** Must mount the socket: `-v /var/run/docker.sock:/var/run/docker.sock`

**Remote:** Set `host` to `tcp://ip:port`. TLS certs must be accessible inside the container.

---

### AWS (EC2, S3, EKS, RDS)

| Field | Value | Notes |
| ----- | ----- | ----- |
| Name | `aws-prod` | Display name |
| Type | `aws` | |
| Profile | `default` | AWS CLI profile (from `~/.aws/config`) |
| Region | `us-east-1` | AWS region |
| Access Key ID | `AKIA...` | Optional — explicit key (overrides profile) |
| Secret Access Key | `***` | Optional — with access key |
| Session Token | `***` | Optional — for temporary STS credentials |
| Endpoint URL | `http://localhost:4566` | Optional — for LocalStack |

**Auth priority:**
1. Explicit keys (access_key_id + secret_access_key) → env vars injected per command
2. Profile → `AWS_PROFILE` env var set per command
3. No config → AWS SDK default chain (IAM role, EC2 metadata, etc.)

**Local:** `aws configure` or `~/.aws/credentials`.

**Docker:** Mount: `-v ~/.aws:/root/.aws:ro`. Or use explicit keys (no mount needed).

---

### GCP (Compute, GKE, Storage, IAM)

| Field | Value | Notes |
| ----- | ----- | ----- |
| Name | `gcp-prod` | Display name |
| Type | `gcp` | |
| Project | `my-project-id` | GCP project ID |
| Region | `us-central1` | Default region |
| Zone | `us-central1-a` | Optional — overrides region |
| Service Account Key File | `/path/to/key.json` | Optional — for service account auth |

**Auth:** User login (`gcloud auth login`) or service account JSON.

**Local:** `gcloud auth login` + `gcloud config set project my-project`.

**Docker:** Mount: `-v ~/.config/gcloud:/root/.config/gcloud:ro`. Or mount service account key and set path.

---

### Azure (VMs, AKS, Storage, Resource Groups)

| Field | Value | Notes |
| ----- | ----- | ----- |
| Name | `azure-prod` | Display name |
| Type | `azure` | |
| Subscription | `sub-id` | Azure subscription ID |
| Resource Group | `my-rg` | Default resource group |
| Tenant | `tenant-id` | Optional — Azure AD tenant |

**Auth:** `az login` (interactive browser) or service principal.

**Local:** `az login`.

**Docker:** Mount: `-v ~/.azure:/root/.azure:ro`. For headless: service principal login.

---

### Terraform (State, Plan, Outputs)

| Field | Value | Notes |
| ----- | ----- | ----- |
| Name | `infra` | Display name |
| Type | `terraform` | |
| Workspace | `/path/to/terraform/code` | Directory containing `.tf` files |

**Auth:** Terraform inherits cloud provider credentials (AWS/GCP/Azure). No separate auth.

**Local:** Workspace path must exist on local filesystem.

**Docker:** Mount the workspace: `-v /path/to/tf:/tf:ro` and set workspace to `/tf`.

---

## 5. Data & Persistence

### Files

| File | Contents | Thread-safe |
| ---- | -------- | ----------- |
| `aziro.db` | SQLite — events, snapshots, AI analyses | Yes (WAL mode) |
| `targets.json` | Encrypted target configs | Atomic write (temp + replace) |
| `chat_sessions.json` | Chat session metadata | No — race condition risk |
| `chat_messages.json` | Chat message history | No — race condition risk |
| `.aziro_key` | Fernet encryption key (chmod 600) | Read-only after creation |

### Path resolution

| Env var | Default | Controls |
| ------- | ------- | -------- |
| `AZIRO_DATA_DIR` | Project root | `aziro.db`, `targets.json`, `chat_*.json` |
| `AZIRO_KEY_FILE` | `$AZIRO_DATA_DIR/.aziro_key` | Encryption key location |

**Docker sets both to `/app/data/`** → everything lands on the named volume.

### Encryption

- Credentials in `targets.json` are encrypted at rest using Fernet (AES-128-CBC + HMAC-SHA256).
- Key generated on first run, stored in `.aziro_key`.
- `load_safe()` returns masked values (`***`) for the frontend.
- `get()` returns decrypted values for internal tool execution.
- Old plaintext secrets are auto-migrated to encrypted on next load.

### Backup

```bash
# Docker
docker run --rm -v aziro-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/aziro-backup.tar.gz /data

# Local
tar czf aziro-backup.tar.gz targets.json aziro.db chat_*.json .aziro_key
```

---

## 6. Docker Reference

### Dockerfile architecture (multi-stage parallel build)

```
┌──────────── PARALLEL (BuildKit) ─────────────┐
│  cli-kubectl    alpine + wget       ~50 MB    │
│  cli-aws        python-slim + zip   ~60 MB    │
│  cli-gcloud     google/cloud-sdk    ~180 MB   │
│  cli-azure      mcr.ms/azure-cli    ~250 MB   │
│  cli-terraform  alpine + wget       ~80 MB    │
│  cli-helm       alpine + wget       ~50 MB    │
│  cli-docker     alpine + wget       ~60 MB    │
│  python-deps    venv + pip          ~30 MB    │
└──────────────────────────────────────────────┘
                      │ COPY --from=*
                      ▼
┌──────────── FINAL (python:3.12-slim) ────────┐
│  System tools (ps, df, ip, dig, etc.)        │
│  All CLI binaries from above                 │
│  Python venv + app code                      │
│  Total: ~800 MB                              │
└──────────────────────────────────────────────┘
```

**Build:** `DOCKER_BUILDKIT=1 docker build -t aziro-ops .` (~2-3 min cold, <30s warm)

**Requires:** Docker with BuildKit (`docker-buildx` plugin).

### Volume mounts

```bash
docker run -d --name aziro-ops \
  -p 5000:5000 \
  -v aziro-data:/app/data \
  \
  # Kubernetes (required for K8s targets)
  -v ~/.kube:/root/.kube:ro \
  \
  # Cloud credentials (uncomment what you use)
  -v ~/.aws:/root/.aws:ro \
  -v ~/.config/gcloud:/root/.config/gcloud:ro \
  -v ~/.azure:/root/.azure:ro \
  \
  # SSH keys (for key-based SSH targets)
  -v ~/.ssh:/root/.ssh:ro \
  \
  # Docker socket (for Docker targets)
  -v /var/run/docker.sock:/var/run/docker.sock \
  \
  # Terraform workspace (for Terraform targets)
  -v /path/to/tf:/tf:ro \
  \
  # Host network access (for local clusters)
  --add-host=host.docker.internal:host-gateway \
  \
  --env-file .env \
  aziro-ops
```

### Docker Compose

```bash
docker compose up --build     # requires docker-buildx plugin
```

### What breaks in Docker vs local

| Target | Local | Docker | Fix |
| ------ | ----- | ------ | --- |
| K8s (local cluster) | Works | Cannot reach 127.0.0.1 | `--network host` or edit kubeconfig |
| K8s (EKS) | Works | Needs AWS creds | Mount `~/.aws` |
| K8s (GKE) | Works | Needs GCP creds | Mount `~/.config/gcloud` |
| K8s (AKS) | Works | Needs Azure creds | Mount `~/.azure` |
| SSH (password) | Works | Works | None |
| SSH (key) | Works | Key file missing | Mount `~/.ssh` |
| Docker (local) | Works | No socket | Mount `/var/run/docker.sock` |
| AWS (profile) | Works | Creds missing | Mount `~/.aws` |
| AWS (explicit keys) | Works | Works | None (env vars) |
| GCP (user login) | Works | Tokens missing | Mount `~/.config/gcloud` |
| Azure (az login) | Works | Interactive fails | Mount `~/.azure` or use service principal |
| Terraform | Works | Workspace missing | Mount workspace directory |
| Ollama | Works | Can't reach localhost | Set `OLLAMA_API_BASE=http://host.docker.internal:11434` |

---

## 7. Troubleshooting

### "Failed to load events — is the backend running?"

Frontend can't reach the API. Causes:
1. **AZIRO_API_KEY set but frontend not rebuilt** — The backend injects the key into `index.html`. Rebuild frontend: `cd frontend && npm run build`.
2. **Container not running** — `docker ps` to check.
3. **Port not mapped** — Ensure `-p 5000:5000`.

### "executable aws not found" (EKS)

The `aws` CLI is missing. In Docker, it's baked into the image via multi-stage build. If using an old image, rebuild: `docker build -t aziro-ops .`

### "connection refused" (kind/minikube from Docker)

Local clusters listen on `127.0.0.1` which is the container's loopback, not the host's. Options:
- Use `--network host` (Linux only)
- Use `--add-host=host.docker.internal:host-gateway` and update kubeconfig server URL

### "Ollama is not running"

- **Local:** Start Ollama: `ollama serve`
- **Docker:** Set `OLLAMA_API_BASE=http://host.docker.internal:11434` in `.env`. On Linux also add `--add-host=host.docker.internal:host-gateway`.

### "Model not found"

Download the model first: `ollama pull llama3.1:8b`. Or switch to a cloud provider in `.env`.

### Encryption key lost

If `.aziro_key` is deleted, all encrypted credentials in `targets.json` become unreadable. You'll need to delete `targets.json` and re-add all targets. **Back up the key.**

### JSON file corrupted

If `chat_sessions.json` or `chat_messages.json` becomes corrupted (malformed JSON), delete the file. Chat history will be lost but the app will recreate it.
