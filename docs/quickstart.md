# Quickstart

Get Aziro Ops running in under 5 minutes.

---

## 1. Prerequisites

- Docker + Docker Compose
- An AI model (cloud API key or local Ollama)
- (Optional) Ollama on the host for automatic fallback

---

## 2. Choose your AI provider

| Provider | Setup | Cost | Fallback |
| -------- | ----- | ---- | -------- |
| **Gemini** (recommended) | API key from Google AI Studio | Free tier | Auto-fallback to Ollama |
| **Ollama** | Install locally, no account | Free | Already local |
| **Groq** | Sign up, get API key | Free tier | Auto-fallback to Ollama |
| **OpenAI** | Sign up, get API key | Paid | Auto-fallback to Ollama |

**Recommended setup:** Gemini as primary + Ollama as fallback. When Gemini quota
exhausts, the system auto-switches to Ollama and auto-recovers when quota resets.

---

## 3. Setup Ollama on host (recommended)

Ollama provides free, local AI as automatic fallback when cloud quota runs out.

```bash
# Install
curl -fsSL https://ollama.ai/install.sh | sh

# Pull the best model for DevOps tool-calling
ollama pull qwen2.5:7b

# Enable auto-start
sudo systemctl enable ollama
sudo systemctl start ollama

# Verify
ollama list
```

> **⚠ Docker on Linux:** Ollama's default bind is `127.0.0.1:11434`, which Docker containers **cannot** reach via `host.docker.internal`. You **must** rebind it to all interfaces. For systemd installs, edit `/etc/systemd/system/ollama.service` and add under `[Service]`:
> ```
> Environment="OLLAMA_HOST=0.0.0.0:11434"
> ```
> Then `sudo systemctl daemon-reload && sudo systemctl restart ollama`. For manual starts (e.g., Codespace, WSL): `OLLAMA_HOST=0.0.0.0:11434 ollama serve &`
>
> On macOS, Ollama already binds to `0.0.0.0` by default — no change needed.

Skip this step if you only want cloud models (no fallback).

---

## 4a. Run with Docker (recommended)

```bash
git clone https://github.com/gkhandale-aziro/devops-ai.git
cd devops-ai
cp .env.example .env
```

Edit `.env` with your AI provider:

```bash
# ── Primary AI model ──────────────────────────────
# Option A: Gemini (recommended)
AI_MODEL=gemini/gemini-2.5-flash
GEMINI_API_KEY=your-key-from-aistudio.google.com

# Option B: Ollama only (free, no API key)
# AI_MODEL=ollama/qwen2.5:7b

# Option C: Other cloud providers
# AI_MODEL=gpt-4o-mini
# OPENAI_API_KEY=sk-...

# ── Ollama fallback (Docker → host) ───────────────
# Required if Ollama runs on the host (not in container)
OLLAMA_API_BASE=http://host.docker.internal:11434

# ── Sandbox ───────────────────────────────────────
SANDBOX=local
```

Build and run:

```bash
docker-compose up -d
```

Open **http://localhost:5000**

## 4b. Run without Docker

```bash
git clone https://github.com/gkhandale-aziro/devops-ai.git
cd devops-ai
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` — same options as above, but skip `OLLAMA_API_BASE` (Ollama is on localhost by default).

```bash
python3 app.py
```

Open **http://localhost:5000**

---

## 5. Add your first target

Click **+ Add Connection** in the sidebar.

### Kubernetes

1. Select **Kubernetes**
2. Enter a name and your kubectl context (`kubectl config get-contexts`)
3. Click **Test & Save**

**Docker + local cluster?**

- **kind** (or GitHub Codespaces with kind): connect Aziro to kind's network and use the internal kubeconfig.
  ```bash
  docker network connect kind aziro-ops
  kind get kubeconfig --name <cluster> --internal > ~/.kube/config
  chmod 644 ~/.kube/config
  ```
  In the UI, pick the internal context. Full walk-through incl. host+container merge: [setup-guide.md § Local kubeconfig](setup-guide.md#local-kubeconfig-kind-minikube-docker-desktop).

- **minikube / Docker Desktop:** rewrite the server URL once on the host.
  ```bash
  kubectl config set-cluster <cluster-name> \
    --server=https://host.docker.internal:6443 \
    --insecure-skip-tls-verify=true
  ```

Cloud clusters (EKS/GKE/AKS) work without extra steps — Aziro ships `aws`, `gcloud`, `gke-gcloud-auth-plugin`, and `az` in the image and mounts your credentials directories.

### SSH server

1. Select **SSH**
2. Enter hostname (use IP if running in Docker), port, username, password
3. Click **Test & Save**

### Docker

1. Select **Docker**
2. Leave defaults for local Docker
3. Click **Test & Save**

---

## 6. Explore

- **Dashboard** — Real-time resource views, metric charts, ring gauges
- **AI Chat** — Ask questions about any target (see tool calls + output)
- **Live Alerts** — Start monitoring a K8s target for SEV1/2/3 alerts
- **History** — Browse past incidents, filter by severity/namespace
- **Cmd+K** — Search targets, pages, and K8s resources from anywhere
- **Settings** — Change AI model, theme, view shortcuts

---

## 7. Change AI model (no restart needed)

### From the UI

Go to **Settings** > **AI Model Selection** > type a new model > **Save**.

### From the API

```bash
curl -X PUT http://localhost:5000/api/v1/models \
  -H "Content-Type: application/json" \
  -d '{"ai_model": "gemini/gemini-2.5-flash"}'
```

### Supported model formats

```
gemini/gemini-2.5-flash       # Google Gemini
gemini/gemini-2.5-pro         # Google Gemini Pro
gpt-4o-mini                   # OpenAI
claude-haiku-4-5-20251001     # Anthropic
groq/llama-3.1-8b-instant     # Groq
ollama/qwen2.5:7b             # Local Ollama
ollama/llama3.1:8b            # Local Ollama
```

---

## 8. Auto-fallback (built-in resilience)

When your cloud AI model hits quota or rate limits:

1. System detects the error (HTTP 429, quota exceeded, etc.)
2. Auto-discovers Ollama models on the host
3. Switches to the best available model (prefers `qwen2.5:7b`)
4. Shows a banner in the UI: "Quota exhausted — using Ollama"
5. Retries primary model every 5 minutes
6. Auto-switches back when quota resets

**No manual intervention needed.** Just ensure Ollama is running with at least
one model pulled.

```
  Gemini (primary)
       │
  quota exhausted?
       │
  ┌────▼────┐     ┌──────────────┐
  │ Detect  │────►│ Ollama found │──► auto-switch to qwen2.5:7b
  │ error   │     └──────────────┘
  └─────────┘            │
                   retry every 5m
                         │
                   quota reset? ──► switch back to Gemini
```

---

## Next steps

- [Setup Guide](setup-guide.md) — Docker architecture, persistence, cloud auth, troubleshooting
- [README](../README.md) — features, architecture, differentiators
