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

App runs in a container. Persistent data on a Docker volume. Cloud CLIs baked into the image via multi-stage parallel build.

```bash
# Build (requires docker-buildx plugin)
DOCKER_BUILDKIT=1 docker build -t aziro-ops .

# Run with the launcher script (recommended — mounts everything upfront)
chmod +x docker-run.sh
./docker-run.sh

# Or via Docker Compose
docker compose up --build
```

The launcher script pre-mounts all credential directories and the Docker socket. Directories can be empty — they're live bind mounts, so `aws configure` or `gcloud auth login` on the host is reflected instantly. **No restart needed to add new targets.**

You can also skip host mounts entirely and **paste credentials directly in the UI** (kubeconfig YAML, GCP SA key JSON, SSH private keys, AWS access keys).

### Key differences

| Aspect | Local | Docker |
| ------ | ----- | ------ |
| Data location | Project root (`./targets.json`, `./aziro.db`) | `/app/data/` volume |
| Cloud CLIs | Use your system installs | Baked into image (kubectl, aws, gcloud, az, terraform, helm, docker) |
| Kubeconfig | `~/.kube/config` | Pre-mounted read-only, or paste content in UI |
| Cloud creds | `~/.aws`, `~/.config/gcloud`, `~/.azure` | Pre-mounted read-only, or enter keys in UI |
| SSH keys | `~/.ssh/` | Pre-mounted read-only, or paste key content in UI |
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

**In Docker:** Ollama runs on the host, not in the container. Two things must be correct:

**1.** Set `OLLAMA_API_BASE` in `.env`:
```bash
# .env
AI_MODEL=ollama/llama3.1:8b
OLLAMA_API_BASE=http://host.docker.internal:11434
```

**2. Linux only — rebind Ollama to all interfaces.** By default on Linux, `ollama serve` binds to `127.0.0.1:11434`, which is only reachable from the host itself. Docker containers hitting `host.docker.internal:11434` get "connection refused". Fix:

- **systemd install:** edit `/etc/systemd/system/ollama.service`, add under `[Service]`:
  ```
  Environment="OLLAMA_HOST=0.0.0.0:11434"
  ```
  then `sudo systemctl daemon-reload && sudo systemctl restart ollama`
- **Manual start** (Codespace, WSL, dev):
  ```bash
  OLLAMA_HOST=0.0.0.0:11434 ollama serve &
  ```

macOS Ollama already binds to `0.0.0.0` — no change needed.

The launcher script (`docker-run.sh`) adds `--add-host=host.docker.internal:host-gateway` automatically for Linux, so DNS resolution works out of the box. The bind issue is the only remaining gotcha.

Without `OLLAMA_API_BASE`, the container tries to reach Ollama at `localhost:11434` inside itself — which doesn't exist.

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

### Runtime model API

Change models without restarting the container or process:

```bash
# Check current models
curl http://127.0.0.1:5000/api/v1/info -H "Authorization: Bearer <key>"

# List available Ollama models
curl http://127.0.0.1:5000/api/v1/models -H "Authorization: Bearer <key>"

# Switch to a single model
curl -X PUT http://127.0.0.1:5000/api/v1/models \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"ai_model": "gpt-4o-mini"}'

# Switch to two-model setup
curl -X PUT http://127.0.0.1:5000/api/v1/models \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"tool_model": "groq/llama-3.1-8b-instant", "answer_model": "claude-haiku-4-5-20251001"}'
```

Changes take effect on the next request. No restart, no rebuild.

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
| Kubeconfig content | (paste YAML) | Optional — paste full kubeconfig in UI |
| Kubeconfig path | `/app/data/.kube/config` | Only if file exists inside container |

**Two ways to provide kubeconfig:**

1. **Paste in UI** — paste the kubeconfig YAML content directly in the "Kubeconfig content" textarea. The backend writes it to `/app/data/creds/<id>/kubeconfig` on the data volume. No host mounts needed.
2. **Host mount** — the launcher script pre-mounts `~/.kube` read-only. Host kubeconfig changes are reflected instantly.

**Local clusters (kind, minikube, kubeadm, k3s, Docker Desktop) in Docker:**

Local clusters bind their API server to `127.0.0.1:<random-port>` on the host, which is unreachable from inside the Aziro container because the container's own loopback is separate. Two working approaches depending on the cluster:

**Approach A — kind (preferred):** kind runs its control plane as a Docker container on a dedicated `kind` network. Connect the Aziro container to that network and use kind's built-in `--internal` kubeconfig, which resolves to the control-plane container's hostname (`<cluster>-control-plane:6443`) instead of host loopback.

```bash
# 1. Attach Aziro to the kind network (per container, not persistent)
docker network connect kind aziro-ops

# 2. Merge host-facing + internal-facing kubeconfigs under two context names
kind get kubeconfig --name <cluster> > /tmp/kube-host.yaml
kind get kubeconfig --name <cluster> --internal > /tmp/kube-internal.yaml
sed -i 's/kind-<cluster>/kind-<cluster>-internal/g' /tmp/kube-internal.yaml
KUBECONFIG=/tmp/kube-host.yaml:/tmp/kube-internal.yaml \
  kubectl config view --flatten > ~/.kube/config
chmod 644 ~/.kube/config

# 3. Verify both work
kubectl get nodes                                             # uses kind-<cluster>
docker exec aziro-ops kubectl --context=kind-<cluster>-internal get nodes
```

Replace `<cluster>` with your kind cluster name. In the Aziro UI use context **`kind-<cluster>-internal`** (the in-network one). Your host shell keeps using `kind-<cluster>` for normal `kubectl`.

To make the network attach persistent across rebuilds, add once the `kind` network exists:

```yaml
# docker-compose.yml
services:
  aziro:
    networks:
      - default
      - kind
networks:
  kind:
    external: true
```

**Approach B — rewrite server URL (minikube, Docker Desktop, or kind recreated with a fixed port):** Works when the API server is bound to `0.0.0.0` or a predictable port. Point the cluster entry at `host.docker.internal` and skip TLS verification (the cert won't include that hostname):

```bash
kubectl config set-cluster <cluster-name> \
  --server=https://host.docker.internal:6443 \
  --insecure-skip-tls-verify=true
```

No container restart needed — kubeconfig is a live bind mount. Add the target in the UI with just the **Context** field filled in.

**Kubeconfig permissions:** The container runs as a non-root `aziro` user. Local kubeconfigs are usually `600`, so the container's read-only mount gets "permission denied". Fix:

```bash
chmod 644 ~/.kube/config
```

Safe on ephemeral dev environments (Codespaces, kind VMs). On a shared machine, scope it to an `aziro` group instead — see the [security note in the troubleshooting section](#permission-denied-on-kubeconfig).

**Alternative — paste in UI:** Skip host mounts entirely and paste kubeconfig YAML directly into the **Kubeconfig content** field. Run `kubectl config view --minify --raw --flatten --context=<ctx>` to get a standalone kubeconfig. Remember to rewrite the server URL to something the container can reach.

**GitHub Codespaces:** kind works great in Codespaces (Docker-in-Docker is already available). Follow Approach A above exactly — the `docker network connect kind` step is the key. For Codespaces-specific Ollama setup, see the Ollama section.

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

**Docker:** Pre-mounted by `docker-run.sh`. Or enter explicit access keys in the AWS target config (no mount needed). The `aws` CLI is baked into the image.

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

**Docker:** Pre-mounted by `docker-run.sh`. Or paste service account JSON in the UI (no mount needed).

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

**Docker:** Pre-mounted by `docker-run.sh`. For headless Docker, use service principal: `az login --service-principal`.

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
- Key auth: Pre-mounted by `docker-run.sh`, or paste private key content in the UI.
- To SSH into the Docker host itself: use `host.docker.internal` as the hostname (the launcher adds `--add-host` for this).

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

**Docker:** Pre-mounted by `docker-run.sh`. Or use explicit keys (no mount needed).

---

### GCP (Compute, GKE, Storage, IAM)

| Field | Value | Notes |
| ----- | ----- | ----- |
| Name | `gcp-prod` | Display name |
| Type | `gcp` | |
| Project | `my-project-id` | GCP project ID |
| Region | `us-central1` | Default region |
| Zone | `us-central1-a` | Optional — overrides region |
| Service Account Key JSON | (paste JSON content) | Optional — paste in UI, saved to data volume |
| SA Key File path | `/path/to/key.json` | Only if file exists inside container |

**Auth:** User login (`gcloud auth login`) or service account JSON.

**Local:** `gcloud auth login` + `gcloud config set project my-project`.

**Docker:** Pre-mounted by `docker-run.sh`. Or paste service account key JSON directly in the UI (no mount needed).

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

**Docker:** Pre-mounted by `docker-run.sh`. For headless: service principal login.

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
| `creds/<tid>/` | Inline credentials pasted via UI | Written once per target |
| `.kube/config` | Container-generated kubeconfig | Written by EKS/GKE/AKS setup |

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

```text
┌──────────── PARALLEL (BuildKit) ─────────────┐
│  cli-kubectl    alpine + wget       ~50 MB    │
│  cli-aws        python-slim + zip   ~60 MB    │
│  cli-gcloud     google/cloud-sdk    ~180 MB   │
│  cli-azure      pip install azure   ~200 MB   │
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

**Security:** The container runs as a non-root `aziro` user with reduced privileges. Docker Compose enforces resource limits (2 GB RAM, 2 CPUs).

### Volume mount architecture

The launcher script (`docker-run.sh`) and `docker-compose.yml` mount everything upfront so you never need to restart the container to add targets:

```bash
# Host credentials → mounted read-only at /home/aziro/.host-*
~/.kube           → /home/aziro/.host-kube:ro      # Kubernetes kubeconfig
~/.aws            → /home/aziro/.host-aws:ro       # AWS credentials
~/.config/gcloud  → /home/aziro/.host-gcloud:ro    # GCP tokens
~/.azure          → /home/aziro/.host-azure:ro     # Azure tokens
~/.ssh            → /home/aziro/.ssh:ro            # SSH keys
/var/run/docker.sock → /var/run/docker.sock         # Docker daemon

# Cloud CLIs pointed to host mounts via env vars:
KUBECONFIG=/home/aziro/.host-kube/config:/app/data/.kube/config
AWS_SHARED_CREDENTIALS_FILE=/home/aziro/.host-aws/credentials
AWS_CONFIG_FILE=/home/aziro/.host-aws/config
CLOUDSDK_CONFIG=/home/aziro/.host-gcloud
AZURE_CONFIG_DIR=/home/aziro/.host-azure
```

**Key design:** Host kubeconfig is read-only. When cloud setup commands (EKS/GKE/AKS) generate new kubeconfig entries, they write to `/app/data/.kube/config` on the data volume. The `KUBECONFIG` env var merges both.

### Docker Compose

```bash
docker compose up --build     # requires docker-buildx plugin
```

### Adding targets without host mounts

You can skip host mounts entirely. The UI accepts inline credentials:

| Credential | How |
| ---------- | --- |
| Kubeconfig | Paste YAML in "Kubeconfig content" textarea |
| GCP SA key | Paste JSON in "Service Account Key JSON" textarea |
| SSH key | Paste private key content in "Private Key" field |
| AWS keys | Enter Access Key ID + Secret Access Key |

These are written to `/app/data/creds/<target-id>/` on the volume and encrypted at rest.

### What works in Docker

| Target | Mount approach | Inline approach (no mount) |
| ------ | -------------- | -------------------------- |
| K8s (kind) | `docker network connect kind` + `--internal` kubeconfig | Paste kubeconfig with internal hostname |
| K8s (minikube/Docker Desktop) | Rewrite server URL to `host.docker.internal` | Paste kubeconfig with `host.docker.internal` |
| K8s (EKS) | Pre-mounted `~/.aws` | Enter access key + secret in UI |
| K8s (GKE) | Pre-mounted `~/.config/gcloud` | Paste SA key JSON in UI |
| K8s (AKS) | Pre-mounted `~/.azure` | Service principal creds |
| SSH (password) | Works out of the box | Works out of the box |
| SSH (key) | Pre-mounted `~/.ssh` | Paste key content in UI |
| Docker (local) | Pre-mounted socket | N/A — socket always needed |
| Docker (remote) | Works out of the box | Works out of the box |
| AWS (profile) | Pre-mounted `~/.aws` | Enter keys in UI |
| AWS (explicit keys) | Works out of the box | Works out of the box |
| GCP | Pre-mounted `~/.config/gcloud` | Paste SA key JSON in UI |
| Azure | Pre-mounted `~/.azure` | Service principal creds |
| Terraform | Mount workspace dir | N/A — needs filesystem |
| Ollama | N/A | Set `OLLAMA_API_BASE=http://host.docker.internal:11434` |

---

## 7. Troubleshooting

### "Failed to load events — is the backend running?"

Frontend can't reach the API. Causes:

1. **AZIRO_API_KEY set but frontend not rebuilt** — The backend injects the key into `index.html`. Rebuild frontend: `cd frontend && npm run build`.
2. **Container not running** — `docker ps` to check.
3. **Port not mapped** — Ensure `-p 5000:5000`.

### "executable aws not found" (EKS)

The `aws` CLI is missing. In Docker, it's baked into the image via multi-stage build. If using an old image, rebuild: `docker build -t aziro-ops .`

### "connection refused" (local cluster from Docker)

Local clusters listen on `127.0.0.1` which is the container's loopback, not the host's. Two fixes depending on the cluster type:

**For kind** (API server bound to a random host port — verify with `docker port <cluster>-control-plane 6443/tcp`):

```bash
docker network connect kind aziro-ops
kind get kubeconfig --name <cluster> --internal > ~/.kube/config
chmod 644 ~/.kube/config
```

**For minikube / Docker Desktop / kind with a fixed 6443 binding:**

```bash
kubectl config set-cluster <cluster-name> --server=https://host.docker.internal:6443 --insecure-skip-tls-verify=true
```

No container restart needed. See [Local kubeconfig](#local-kubeconfig-kind-minikube-docker-desktop) for the full walk-through including the two-context merge so your host `kubectl` keeps working.

### "tls: failed to verify certificate: x509: certificate is valid for ... not host.docker.internal"

The K8s API server cert doesn't include `host.docker.internal` in its SAN list. Fix:

```bash
kubectl config set-cluster <cluster-name> --insecure-skip-tls-verify=true
```

### "permission denied" on kubeconfig

The container runs as non-root user `aziro`. If `~/.kube/config` has `600` permissions, the read-only mount can't be read. Fix:

```bash
chmod 644 ~/.kube/config
```

**Safe on ephemeral dev environments** (Codespaces, a kind VM, a personal laptop you control). On a shared machine where others have host access, scope the loosening to an `aziro` group instead — or skip host mounts entirely and paste the kubeconfig YAML into the UI's **Kubeconfig content** field.

### "Ollama is not running"

- **Local:** Start Ollama: `ollama serve`
- **Docker:** Set `OLLAMA_API_BASE=http://host.docker.internal:11434` in `.env`. On Linux also add `--add-host=host.docker.internal:host-gateway`.

### "Model not found"

Download the model first: `ollama pull llama3.1:8b`. Or switch to a cloud provider in `.env`.

### Encryption key lost

If `.aziro_key` is deleted, all encrypted credentials in `targets.json` become unreadable. You'll need to delete `targets.json` and re-add all targets. **Back up the key.**

### JSON file corrupted

If `chat_sessions.json` or `chat_messages.json` becomes corrupted (malformed JSON), delete the file. Chat history will be lost but the app will recreate it.
