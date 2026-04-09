# Quickstart

Get Aziro Ops running in under 5 minutes.

---

## 1. Choose your AI provider

You need one AI backend. Pick the easiest for you:

| Provider | Setup | Cost |
| -------- | ----- | ---- |
| **Ollama** | Install locally, no account needed | Free |
| **Groq** | Sign up, get API key | Free tier |
| **Gemini** | Sign up, get API key | Free tier |
| **OpenAI** | Sign up, get API key | Paid |

---

## 2a. Run with Docker (recommended)

```bash
git clone https://github.com/gkhandale-aziro/devops-ai.git
cd devops-ai
cp .env.example .env
```

Generate an API key and edit `.env`:

```bash
# Run this to generate a secure key:
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Paste the output into `.env` along with your AI provider:

```bash
# Secures all /api/ routes
AZIRO_API_KEY=<paste-generated-key-here>

# AI provider — pick one:

# Option A: Ollama (local, free — requires `ollama serve` running on host)
AI_MODEL=ollama/llama3.1:8b
OLLAMA_API_BASE=http://host.docker.internal:11434

# Option B: Cloud (no Ollama needed)
AI_MODEL=gemini/gemini-2.0-flash
GEMINI_API_KEY=your-key-here
```

Save the `AZIRO_API_KEY` value — you'll need it for direct API calls. The frontend reads it automatically.

Build and run:

```bash
DOCKER_BUILDKIT=1 docker build -t aziro-ops .
chmod +x docker-run.sh
./docker-run.sh
```

Open **http://127.0.0.1:5000**

## 2b. Run without Docker

```bash
git clone https://github.com/gkhandale-aziro/devops-ai.git
cd devops-ai
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` — generate an API key and pick an AI provider (same options as above, but skip `OLLAMA_API_BASE` since Ollama is on localhost).

```bash
python3 app.py
```

Open **http://localhost:5000**

---

## 3. Add your first target

Click **+ Add Target** in the sidebar.

### Kubernetes

1. Select **Local / kubeconfig**
2. Enter a name and your kubectl context (run `kubectl config get-contexts` to see them)
3. In Docker: paste your kubeconfig YAML in the **Kubeconfig content** field
4. Save

### SSH server

1. Select **SSH**
2. Enter hostname, port, username, and password (or paste a private key)
3. Save

### Docker

1. Select **Docker**
2. Leave all fields blank for local Docker
3. Save

### AWS / GCP / Azure

1. Select the provider
2. Enter your credentials or profile name — or paste keys directly in the UI
3. Save

---

## 4. Explore

- **Dashboard** — Click a target to see resources (pods, nodes, containers, etc.)
- **AI Chat** — Click the chat icon on any target to ask questions about it
- **Alerts** — Start monitoring a K8s target to get live SEV1/2/3 alerts
- **Cmd+K** — Search targets, pages, and live K8s resources from anywhere

---

## 5. Switch AI models (anytime)

No restart needed:

```bash
# Use the AZIRO_API_KEY value from your .env
curl -X PUT http://127.0.0.1:5000/api/v1/models \
  -H "Authorization: Bearer $AZIRO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ai_model": "gpt-4o-mini"}'
```

Or edit `AI_MODEL` in `.env` and restart the container.

---

## Next steps

- [Setup Guide](setup-guide.md) — full reference for all target types, Docker architecture, persistence, troubleshooting
- [README](../README.md) — features, architecture, recommended AI models
