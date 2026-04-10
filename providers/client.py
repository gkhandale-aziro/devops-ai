"""
providers/client.py — AI provider layer using LiteLLM with native tool calling.

Two-model setup (optional):
  TOOL_MODEL   — fast model for deciding which commands to run
  ANSWER_MODEL — smarter model for writing the final analysis

Resilience:
  - Retries with backoff (0s / 10s / 20s / 60s)
  - Detects quota/rate-limit errors (HTTP 429, quota exceeded)
  - Auto-fallback to Ollama when cloud model is exhausted
  - Auto-recovery: retries primary every 5 minutes
  - Exposes health state for UI banners

Examples:
  AI_MODEL=gemini/gemini-2.5-flash python3 main.py
  TOOL_MODEL=ollama/llama3.1:8b ANSWER_MODEL=ollama/gemma3 python3 main.py
"""
import os
import json
import time
import threading
import subprocess
import litellm

litellm.telemetry = False

# Tool definition — same structure as kubectl-ai's FunctionDefinition
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": (
                "Run a shell command on this machine and return the real output. "
                "Use this for ANY question that needs real data: system status, disk, "
                "memory, CPU, processes, Kubernetes resources, Docker containers, "
                "logs, services, network, git, helm, terraform. "
                "Always use real command names — never use placeholders."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The exact shell command to run. Example: kubectl get pods -A"
                    }
                },
                "required": ["command"]
            }
        }
    }
]

# ── Quota / rate-limit error detection ────────────────────────────────────────

_QUOTA_KEYWORDS = [
    "quota", "rate_limit", "rate limit", "429", "resource_exhausted",
    "ResourceExhausted", "exceeded", "too many requests", "billing",
    "insufficient_quota", "RateLimitError",
]

def _is_quota_error(exc: Exception) -> bool:
    """Detect if an exception is a quota/rate-limit error."""
    msg = str(exc).lower()
    return any(kw.lower() in msg for kw in _QUOTA_KEYWORDS)


def _discover_ollama_models() -> list[str]:
    """Return available Ollama model names, or [] if Ollama is not reachable."""
    try:
        out = subprocess.run(
            ["ollama", "list"], capture_output=True, text=True, timeout=5,
        )
        models = []
        for line in out.stdout.strip().split("\n")[1:]:
            parts = line.split()
            if parts:
                models.append(parts[0])
        return models
    except Exception:
        return []


# ── Model health state ────────────────────────────────────────────────────────

class ModelHealth:
    """
    Tracks model health state machine:
      HEALTHY → DEGRADED → FALLBACK (auto) or UNAVAILABLE (no Ollama)
      Any state → HEALTHY (when primary recovers)
    """
    HEALTHY     = "healthy"
    DEGRADED    = "degraded"       # quota hit, retrying
    FALLBACK    = "fallback"       # using Ollama automatically
    UNAVAILABLE = "unavailable"    # quota hit, no Ollama available

    def __init__(self):
        self.status: str = self.HEALTHY
        self.primary_tool: str = ""
        self.primary_answer: str = ""
        self.fallback_model: str = ""
        self.error_message: str = ""
        self.last_error_time: float = 0
        self.last_recovery_check: float = 0
        self._lock = threading.Lock()
        self._listeners: list = []

    def on_change(self, callback):
        """Register a callback for status changes: callback(health_dict)."""
        self._listeners.append(callback)

    def _notify(self):
        info = self.to_dict()
        for cb in self._listeners:
            try:
                cb(info)
            except Exception:
                pass

    def set_degraded(self, error_msg: str, fallback_model: str = ""):
        with self._lock:
            self.error_message = error_msg
            self.last_error_time = time.time()
            if fallback_model:
                self.status = self.FALLBACK
                self.fallback_model = fallback_model
            else:
                self.status = self.UNAVAILABLE
            self._notify()

    def set_healthy(self):
        with self._lock:
            if self.status == self.HEALTHY:
                return
            self.status = self.HEALTHY
            self.error_message = ""
            self.fallback_model = ""
            self._notify()

    def to_dict(self) -> dict:
        with self._lock:
            return {
                "status": self.status,
                "primary_tool": self.primary_tool,
                "primary_answer": self.primary_answer,
                "fallback_model": self.fallback_model,
                "error_message": self.error_message,
                "since": self.last_error_time if self.status != self.HEALTHY else 0,
            }


# ── LLM Client ───────────────────────────────────────────────────────────────

RECOVERY_INTERVAL = 300  # 5 minutes between recovery attempts

class LLMClient:
    """
    Wraps LiteLLM with auto-fallback to Ollama on quota exhaustion.

    Attributes
    ----------
    tool_model   : model used when tool calling is enabled  (fast)
    answer_model : model used for final streaming answer    (smart)
    health       : ModelHealth state for UI consumption
    """

    def __init__(self):
        _default          = os.environ.get("AI_MODEL", "ollama/llama3.1:8b")
        self.tool_model   = os.environ.get("TOOL_MODEL",   _default)
        self.answer_model = os.environ.get("ANSWER_MODEL", self.tool_model)
        self.health       = ModelHealth()
        self.health.primary_tool   = self.tool_model
        self.health.primary_answer = self.answer_model

    def _effective_model(self, use_tools: bool) -> str:
        """Return the model to actually use, accounting for fallback state."""
        if self.health.status == ModelHealth.FALLBACK and self.health.fallback_model:
            return self.health.fallback_model
        return self.tool_model if use_tools else self.answer_model

    def _try_recovery(self) -> bool:
        """
        If in fallback, periodically test if primary model is back.
        Returns True if recovery succeeded (primary is healthy again).
        """
        if self.health.status not in (ModelHealth.FALLBACK, ModelHealth.UNAVAILABLE):
            return False
        now = time.time()
        if now - self.health.last_recovery_check < RECOVERY_INTERVAL:
            return False
        self.health.last_recovery_check = now

        print(f"  [AI] Recovery check — testing primary model {self.tool_model}...")
        try:
            litellm.completion(
                model=self.tool_model,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=5,
            )
            print(f"  [AI] Recovery succeeded — switching back to {self.tool_model}")
            self.health.set_healthy()
            return True
        except Exception as e:
            if _is_quota_error(e):
                print(f"  [AI] Recovery failed — still quota-limited: {e}")
            else:
                # Non-quota error on recovery — might be a different issue,
                # but primary could still work for real requests
                print(f"  [AI] Recovery probe got non-quota error: {e}")
            return False

    def _activate_fallback(self, error: Exception):
        """Detect Ollama, switch to fallback if available."""
        ollama_models = _discover_ollama_models()
        if ollama_models:
            fallback = ollama_models[0]
            print(f"  [AI] Quota exhausted — falling back to Ollama: {fallback}")
            self.health.set_degraded(str(error), fallback_model=fallback)
        else:
            print(f"  [AI] Quota exhausted — no Ollama available")
            self.health.set_degraded(str(error))

    # ── non-streaming ────────────────────────────────────────────────────────

    def chat(self, messages, use_tools=True):
        """
        Send messages to AI with retry + auto-fallback on quota errors.
        Returns (reply_text, command_or_None, tool_call_id_or_None).
        """
        # Check if primary recovered
        self._try_recovery()

        delays    = [0, 10, 20, 60]
        last_err  = None
        for attempt, delay in enumerate(delays):
            if delay:
                print(f"  [AI] retry {attempt}/{len(delays)-1} — waiting {delay}s...")
                time.sleep(delay)
            try:
                result = self._chat_once(messages, use_tools)
                # If we were in fallback and this succeeded, good
                if self.health.status != ModelHealth.HEALTHY:
                    model = self._effective_model(use_tools)
                    if model == self.tool_model or model == self.answer_model:
                        self.health.set_healthy()
                return result
            except Exception as e:
                last_err = e
                if _is_quota_error(e):
                    print(f"  [AI] Quota/rate-limit error: {e}")
                    if self.health.status == ModelHealth.HEALTHY:
                        self._activate_fallback(e)
                    # If fallback is active, retry immediately with fallback model
                    if self.health.status == ModelHealth.FALLBACK:
                        try:
                            return self._chat_once(messages, use_tools)
                        except Exception as e2:
                            last_err = e2
                    break  # don't retry quota errors with same model
                if attempt < len(delays) - 1:
                    print(f"  [AI] attempt {attempt+1} failed: {e}")
        raise last_err

    def _chat_once(self, messages, use_tools):
        """Single (non-retried) AI call."""
        model  = self._effective_model(use_tools)
        kwargs = {"model": model, "messages": messages}
        if use_tools:
            kwargs["tools"] = TOOLS

        t0       = time.time()
        response = litellm.completion(**kwargs)
        elapsed  = time.time() - t0
        choice   = response.choices[0]
        print(f"  [AI] {model} | tools={'yes' if use_tools else 'no'} | {elapsed:.1f}s | tokens={response.usage.total_tokens if response.usage else '?'}")

        if choice.message.tool_calls:
            tool_call = choice.message.tool_calls[0]
            command   = tool_call.function.arguments
            if isinstance(command, str):
                command = json.loads(command)
            return choice.message.content or "", command.get("command"), tool_call.id

        return choice.message.content or "", None, None

    # ── streaming ────────────────────────────────────────────────────────────

    def chat_stream(self, messages, use_tools=False):
        """Stream AI response token by token. Yields text chunks."""
        self._try_recovery()

        model    = self._effective_model(use_tools)
        kwargs   = {"model": model, "messages": messages, "stream": True}

        try:
            t0       = time.time()
            response = litellm.completion(**kwargs)
            for chunk in response:
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    yield delta.content
            elapsed = time.time() - t0
            print(f"  [AI] {model} | stream | {elapsed:.1f}s")
            # Successful stream — if we were degraded, we recovered
            if self.health.status != ModelHealth.HEALTHY:
                if model == self.tool_model or model == self.answer_model:
                    self.health.set_healthy()
        except Exception as e:
            if _is_quota_error(e):
                if self.health.status == ModelHealth.HEALTHY:
                    self._activate_fallback(e)
                # Retry with fallback
                if self.health.status == ModelHealth.FALLBACK:
                    fallback_model = self.health.fallback_model
                    kwargs["model"] = fallback_model
                    t0 = time.time()
                    response = litellm.completion(**kwargs)
                    for chunk in response:
                        delta = chunk.choices[0].delta
                        if delta and delta.content:
                            yield delta.content
                    elapsed = time.time() - t0
                    print(f"  [AI] {fallback_model} | stream (fallback) | {elapsed:.1f}s")
                    return
            raise
