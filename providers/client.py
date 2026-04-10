"""
providers/client.py — Production-grade AI provider layer using LiteLLM.

Two-model setup (optional):
  TOOL_MODEL   — fast model for deciding which commands to run
  ANSWER_MODEL — smarter model for writing the final analysis

Resilience (industry-standard):
  - Circuit breaker: instant failover on quota/rate-limit (no retries on 429)
  - Hard timeouts on every API call (30s non-streaming, 60s streaming)
  - Auto-fallback to Ollama when cloud model is exhausted
  - Proactive background health monitor (pings primary every 5 min)
  - Auto-recovery: switches back when primary is healthy again
  - Transient error retries: 3 attempts with short backoff (non-quota only)
  - Exposes health state for UI banners via ModelHealth

Examples:
  AI_MODEL=gemini/gemini-2.5-flash python3 main.py
  TOOL_MODEL=ollama/llama3.1:8b ANSWER_MODEL=ollama/gemma3 python3 main.py
"""
import os
import sys
import json
import time
import threading
import subprocess
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
import litellm

litellm.telemetry = False

# Force unbuffered output so Docker logs show [AI] lines immediately
import functools
print = functools.partial(print, flush=True)

# ── Tool definition ──────────────────────────────────────────────────────────

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

# ── Timeouts ─────────────────────────────────────────────────────────────────

TIMEOUT_CHAT    = 30   # seconds — non-streaming API calls
TIMEOUT_STREAM  = 60   # seconds — streaming API calls (first token)
TIMEOUT_PROBE   = 10   # seconds — health probe / recovery ping

# ── Quota / rate-limit error detection ───────────────────────────────────────

_QUOTA_KEYWORDS = [
    "quota", "rate_limit", "rate limit", "429", "resource_exhausted",
    "ResourceExhausted", "exceeded", "too many requests", "billing",
    "insufficient_quota", "RateLimitError",
]


def _is_quota_error(exc: Exception) -> bool:
    """Detect if an exception is a quota/rate-limit error."""
    msg = str(exc).lower()
    return any(kw.lower() in msg for kw in _QUOTA_KEYWORDS)


def _is_timeout_error(exc: Exception) -> bool:
    """Detect if an exception is a timeout."""
    msg = str(exc).lower()
    return any(kw in msg for kw in ["timeout", "timed out", "deadline"])


# ── Ollama model discovery ───────────────────────────────────────────────────

_PREFERRED_TOOL_FALLBACKS = [
    "qwen2.5:7b",
    "qwen2.5:3b",
    "llama3.1:8b",
    "gemma3:latest",
    "llama3.2:latest",
]

_PREFERRED_ANSWER_FALLBACKS = [
    "qwen2.5:14b",
    "qwen2.5:7b",
    "llama3.1:8b",
    "gemma3:latest",
    "mixtral:8x7b",
]


def _get_ollama_base() -> str:
    """Return the working Ollama API base URL, or empty string if not reachable."""
    import urllib.request

    urls_to_try = []
    configured = os.environ.get("OLLAMA_API_BASE", "")
    if configured:
        urls_to_try.append(configured)
    for fallback in ["http://host.docker.internal:11434", "http://localhost:11434"]:
        if fallback not in urls_to_try:
            urls_to_try.append(fallback)

    for base in urls_to_try:
        try:
            req = urllib.request.Request(f"{base}/api/tags", method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
                if data.get("models"):
                    if base != configured:
                        os.environ["OLLAMA_API_BASE"] = base
                        print(f"  [AI] Ollama discovered at {base}")
                    return base
        except Exception:
            continue
    return ""


def _discover_ollama_models() -> list[str]:
    """Return available Ollama model names via HTTP API."""
    import urllib.request
    base = _get_ollama_base()
    if not base:
        return []
    try:
        req = urllib.request.Request(f"{base}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []


def _pick_best_fallback(available: list[str], preference: list[str]) -> str:
    """Pick the best fallback model from available Ollama models."""
    for preferred in preference:
        if preferred in available:
            return preferred
    return available[0] if available else ""


# ── Model health state ───────────────────────────────────────────────────────

class ModelHealth:
    """
    Thread-safe health state machine:
      HEALTHY -> FALLBACK (Ollama found) or UNAVAILABLE (no Ollama)
      Any state -> HEALTHY (primary recovered)
    """
    HEALTHY     = "healthy"
    DEGRADED    = "degraded"
    FALLBACK    = "fallback"
    UNAVAILABLE = "unavailable"

    def __init__(self):
        self.status: str = self.HEALTHY
        self.primary_tool: str = ""
        self.primary_answer: str = ""
        self.fallback_tool: str = ""
        self.fallback_answer: str = ""
        self.fallback_model: str = ""
        self.error_message: str = ""
        self.last_error_time: float = 0
        self.last_recovery_check: float = 0
        self._lock = threading.Lock()
        self._listeners: list = []

    def on_change(self, callback):
        self._listeners.append(callback)

    def _notify(self):
        info = self.to_dict()
        for cb in self._listeners:
            try:
                cb(info)
            except Exception:
                pass

    def set_degraded(self, error_msg: str,
                     fallback_tool: str = "", fallback_answer: str = ""):
        with self._lock:
            self.error_message = error_msg
            self.last_error_time = time.time()
            if fallback_tool:
                self.status = self.FALLBACK
                self.fallback_tool = fallback_tool
                self.fallback_answer = fallback_answer or fallback_tool
                if self.fallback_tool == self.fallback_answer:
                    self.fallback_model = self.fallback_tool
                else:
                    self.fallback_model = f"{self.fallback_tool} / {self.fallback_answer}"
            else:
                self.status = self.UNAVAILABLE
            self._notify()

    def set_healthy(self):
        with self._lock:
            if self.status == self.HEALTHY:
                return
            self.status = self.HEALTHY
            self.error_message = ""
            self.fallback_tool = ""
            self.fallback_answer = ""
            self.fallback_model = ""
            self._notify()

    def to_dict(self) -> dict:
        with self._lock:
            return {
                "status": self.status,
                "primary_tool": self.primary_tool,
                "primary_answer": self.primary_answer,
                "fallback_model": self.fallback_model,
                "fallback_tool": self.fallback_tool,
                "fallback_answer": self.fallback_answer,
                "error_message": self.error_message,
                "since": self.last_error_time if self.status != self.HEALTHY else 0,
            }


# ── LLM Client ──────────────────────────────────────────────────────────────

RECOVERY_INTERVAL = 1800  # 30 min between recovery probes (avoid quota yo-yo)
TRANSIENT_RETRIES = 2    # retry transient (non-quota) errors this many times
TRANSIENT_DELAY   = 3    # seconds between transient retries

# ── Config persistence ──────────────────────────────────────────────────────

_CONFIG_FILE = os.path.join(
    os.environ.get("AZIRO_DATA_DIR", os.path.dirname(__file__)),
    "model_config.json",
)


def _load_config() -> dict:
    """Load saved model config from disk."""
    try:
        with open(_CONFIG_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_config(data: dict):
    """Save model config to disk."""
    try:
        os.makedirs(os.path.dirname(_CONFIG_FILE), exist_ok=True)
        with open(_CONFIG_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"  [AI] Failed to save config: {e}")


# ── Cloud model discovery ───────────────────────────────────────────────────

_CLOUD_MODELS: dict[str, list[str]] = {
    "GEMINI_API_KEY": [
        "gemini/gemini-2.5-flash",
        "gemini/gemini-2.0-flash",
        "gemini/gemini-1.5-pro",
    ],
    "OPENAI_API_KEY": [
        "openai/gpt-4o-mini",
        "openai/gpt-4o",
        "openai/gpt-4-turbo",
    ],
    "ANTHROPIC_API_KEY": [
        "anthropic/claude-sonnet-4-20250514",
        "anthropic/claude-haiku-4-20250414",
    ],
}


def discover_cloud_models() -> list[str]:
    """Return cloud models available based on configured API keys."""
    models = []
    for env_key, model_list in _CLOUD_MODELS.items():
        if os.environ.get(env_key):
            models.extend(model_list)
    return models


class LLMClient:
    """
    Production-grade LLM client with circuit-breaker failover.

    Guarantees:
      - Every API call has a hard timeout (never hangs)
      - Quota errors fail-fast and trigger immediate Ollama fallback
      - Transient errors get 2 retries with 3s delay
      - Background thread proactively monitors primary health
      - Auto-recovers when primary comes back
    """

    def __init__(self):
        # Override from saved config (survives container restarts)
        saved = _load_config()
        if saved.get("ollama_api_base"):
            os.environ["OLLAMA_API_BASE"] = saved["ollama_api_base"]

        # Priority: saved config > env vars > auto-discover best available
        if saved.get("tool_model"):
            self.tool_model = saved["tool_model"]
            self.answer_model = saved.get("answer_model", self.tool_model)
        elif os.environ.get("AI_MODEL") or os.environ.get("TOOL_MODEL"):
            _default = os.environ.get("AI_MODEL", "ollama/llama3.1:8b")
            self.tool_model = os.environ.get("TOOL_MODEL", _default)
            self.answer_model = os.environ.get("ANSWER_MODEL", self.tool_model)
        else:
            # Auto-discover: try cloud models first, then Ollama
            self.tool_model, self.answer_model = self._auto_select_best()

        self.health       = ModelHealth()
        self.health.primary_tool   = self.tool_model
        self.health.primary_answer = self.answer_model
        self._monitor_thread: threading.Thread | None = None
        self._monitor_stop = threading.Event()

    @staticmethod
    def _auto_select_best() -> tuple[str, str]:
        """Pick the best available model on startup. Cloud > Ollama."""
        # 1. Try cloud models — test the first (fastest) from each provider
        _CLOUD_PRIORITY = [
            ("GEMINI_API_KEY",    "gemini/gemini-2.5-flash"),
            ("OPENAI_API_KEY",    "openai/gpt-4o-mini"),
            ("ANTHROPIC_API_KEY", "anthropic/claude-haiku-4-20250414"),
        ]
        for env_key, model in _CLOUD_PRIORITY:
            if os.environ.get(env_key):
                print(f"  [AI] Testing {model}...")
                try:
                    with ThreadPoolExecutor(max_workers=1) as pool:
                        future = pool.submit(
                            litellm.completion,
                            model=model,
                            messages=[{"role": "user", "content": "ping"}],
                            max_tokens=5, num_retries=0, timeout=TIMEOUT_PROBE,
                        )
                        future.result(timeout=TIMEOUT_PROBE + 5)
                    print(f"  [AI] Auto-selected: {model}")
                    return model, model
                except Exception as e:
                    print(f"  [AI] {model} unavailable: {str(e)[:100]}")

        # 2. Try Ollama
        ollama_models = _discover_ollama_models()
        if ollama_models:
            tool = f"ollama/{_pick_best_fallback(ollama_models, _PREFERRED_TOOL_FALLBACKS)}"
            answer = f"ollama/{_pick_best_fallback(ollama_models, _PREFERRED_ANSWER_FALLBACKS)}"
            print(f"  [AI] Auto-selected Ollama: tool={tool} answer={answer}")
            return tool, answer

        # 3. Fallback default
        print("  [AI] No models discovered — defaulting to ollama/llama3.1:8b")
        return "ollama/llama3.1:8b", "ollama/llama3.1:8b"

    def switch_model(self, tool_model: str | None = None,
                     answer_model: str | None = None,
                     ai_model: str | None = None) -> dict:
        """
        Switch model at runtime. Resets circuit breaker, persists to disk.
        Returns {"tool_model": ..., "answer_model": ...}.
        """
        if ai_model:
            tool_model = ai_model
            answer_model = ai_model
        if tool_model:
            self.tool_model = tool_model
        if answer_model:
            self.answer_model = answer_model

        # Reset health — user explicitly chose this model
        self.health.primary_tool = self.tool_model
        self.health.primary_answer = self.answer_model
        self.health.set_healthy()
        print(f"  [AI] Model switched: tool={self.tool_model} answer={self.answer_model}")

        # Persist
        saved = _load_config()
        saved["tool_model"] = self.tool_model
        saved["answer_model"] = self.answer_model
        _save_config(saved)

        return {"tool_model": self.tool_model, "answer_model": self.answer_model}

    @staticmethod
    def test_model(model: str) -> dict:
        """
        Quick test if a model is reachable. Returns {"ok": bool, "error": str}.
        """
        try:
            kwargs: dict = {
                "model": model,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 5,
                "num_retries": 0,
                "timeout": TIMEOUT_PROBE,
            }
            # Pass api_base explicitly for Ollama models
            if model.startswith("ollama/"):
                base = os.environ.get("OLLAMA_API_BASE", "") or _get_ollama_base()
                if base:
                    kwargs["api_base"] = base
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(litellm.completion, **kwargs)
                future.result(timeout=TIMEOUT_PROBE + 5)
            return {"ok": True, "error": ""}
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}

    @staticmethod
    def set_ollama_url(url: str) -> dict:
        """Set Ollama API base URL. Persists to disk. Tests connection."""
        url = url.rstrip("/")
        # Test connection
        import urllib.request
        try:
            req = urllib.request.Request(f"{url}/api/tags", method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
                count = len(data.get("models", []))
        except Exception as e:
            return {"ok": False, "error": f"Cannot reach Ollama at {url}: {e}", "models": 0}

        os.environ["OLLAMA_API_BASE"] = url
        saved = _load_config()
        saved["ollama_api_base"] = url
        _save_config(saved)
        print(f"  [AI] Ollama URL set: {url} ({count} models)")
        return {"ok": True, "error": "", "models": count, "url": url}

    @staticmethod
    def get_ollama_url() -> str:
        return os.environ.get("OLLAMA_API_BASE", "http://localhost:11434")

    def start_health_monitor(self):
        """Start background thread that proactively checks primary model health."""
        if self._monitor_thread and self._monitor_thread.is_alive():
            return
        self._monitor_stop.clear()
        self._monitor_thread = threading.Thread(
            target=self._health_monitor_loop, daemon=True, name="ai-health-monitor"
        )
        self._monitor_thread.start()
        print(f"  [AI] Health monitor started (checks every {RECOVERY_INTERVAL}s)")

    def stop_health_monitor(self):
        """Stop the background health monitor."""
        self._monitor_stop.set()

    def _health_monitor_loop(self):
        """Background loop — proactively tests primary model recovery."""
        while not self._monitor_stop.wait(timeout=RECOVERY_INTERVAL):
            if self.health.status in (ModelHealth.FALLBACK, ModelHealth.UNAVAILABLE):
                self._try_recovery()

    # ── Model routing ────────────────────────────────────────────────────────

    def _effective_model(self, use_tools: bool) -> str:
        """Return the model to use, accounting for fallback state."""
        if self.health.status == ModelHealth.FALLBACK:
            if use_tools and self.health.fallback_tool:
                return self.health.fallback_tool
            if not use_tools and self.health.fallback_answer:
                return self.health.fallback_answer
        return self.tool_model if use_tools else self.answer_model

    # ── Recovery ─────────────────────────────────────────────────────────────

    def _try_recovery(self) -> bool:
        """Test if primary model is back online. Returns True on success."""
        now = time.time()
        if now - self.health.last_recovery_check < RECOVERY_INTERVAL:
            return False
        self.health.last_recovery_check = now

        print(f"  [AI] Recovery probe — testing {self.tool_model}...")
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(
                    litellm.completion,
                    model=self.tool_model,
                    messages=[{"role": "user", "content": "ping"}],
                    max_tokens=5,
                    num_retries=0,
                    timeout=TIMEOUT_PROBE,
                )
                future.result(timeout=TIMEOUT_PROBE + 5)
            print(f"  [AI] Recovery OK — switching back to {self.tool_model}")
            self.health.set_healthy()
            return True
        except FuturesTimeout:
            print(f"  [AI] Recovery probe timed out")
            return False
        except Exception as e:
            if _is_quota_error(e):
                print(f"  [AI] Recovery failed — still quota-limited")
            else:
                print(f"  [AI] Recovery probe error: {e}")
            return False

    # ── Fallback activation ──────────────────────────────────────────────────

    def _activate_fallback(self, error: Exception):
        """Discover Ollama models and switch to best available."""
        ollama_models = _discover_ollama_models()
        if ollama_models:
            tool_fb   = _pick_best_fallback(ollama_models, _PREFERRED_TOOL_FALLBACKS)
            answer_fb = _pick_best_fallback(ollama_models, _PREFERRED_ANSWER_FALLBACKS)
            print(f"  [AI] Quota exhausted — fallback: ollama/{tool_fb} (tools), ollama/{answer_fb} (answer)")
            self.health.set_degraded(
                str(error),
                fallback_tool=f"ollama/{tool_fb}",
                fallback_answer=f"ollama/{answer_fb}",
            )
        else:
            print(f"  [AI] Quota exhausted — no Ollama available")
            self.health.set_degraded(str(error))

    def _handle_error(self, error: Exception) -> bool:
        """Handle an API error. Returns True if fallback was activated (caller should retry)."""
        if _is_quota_error(error) or isinstance(error, TimeoutError):
            if self.health.status == ModelHealth.HEALTHY:
                self._activate_fallback(error)
            return self.health.status == ModelHealth.FALLBACK
        return False

    # ── Non-streaming ────────────────────────────────────────────────────────

    def chat(self, messages, use_tools=True):
        """
        Send messages to AI. Returns (reply_text, command_or_None, tool_call_id_or_None).

        Circuit breaker: quota errors trigger immediate fallback, no retry loop.
        Transient errors: up to 2 retries with 3s delay.
        """
        try:
            return self._chat_once(messages, use_tools)
        except Exception as e:
            if self._handle_error(e):
                # Quota error + fallback activated -> retry once with fallback
                return self._chat_once(messages, use_tools)

            if _is_quota_error(e):
                raise  # no fallback available, propagate

            # Transient error -> retry with backoff
            return self._retry_transient(lambda: self._chat_once(messages, use_tools), e)

    @staticmethod
    def _add_ollama_base(kwargs: dict):
        """Inject api_base for Ollama models — env var alone is unreliable."""
        model = kwargs.get("model", "")
        if model.startswith("ollama/"):
            base = os.environ.get("OLLAMA_API_BASE", "")
            if not base:
                base = _get_ollama_base()
            if base:
                kwargs["api_base"] = base

    def _chat_once(self, messages, use_tools):
        """Single API call with hard wall-clock timeout. Never retried internally."""
        model  = self._effective_model(use_tools)
        kwargs = {
            "model": model,
            "messages": messages,
            "num_retries": 0,
            "timeout": TIMEOUT_CHAT,
        }
        if use_tools:
            kwargs["tools"] = TOOLS
        self._add_ollama_base(kwargs)

        t0 = time.time()
        print(f"  [AI] Calling {model} | tools={'yes' if use_tools else 'no'}...")

        # Hard wall-clock timeout — LiteLLM's timeout param is unreliable
        # for some providers. This guarantees we never hang.
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(litellm.completion, **kwargs)
            try:
                response = future.result(timeout=TIMEOUT_CHAT + 5)
            except FuturesTimeout:
                future.cancel()
                raise TimeoutError(f"AI call to {model} timed out after {TIMEOUT_CHAT}s")

        elapsed  = time.time() - t0
        choice   = response.choices[0]
        tokens   = response.usage.total_tokens if response.usage else "?"
        print(f"  [AI] {model} | tools={'yes' if use_tools else 'no'} | {elapsed:.1f}s | tokens={tokens}")

        if self.health.status != ModelHealth.HEALTHY:
            if model in (self.tool_model, self.answer_model):
                self.health.set_healthy()

        if choice.message.tool_calls:
            tool_call = choice.message.tool_calls[0]
            command   = tool_call.function.arguments
            if isinstance(command, str):
                command = json.loads(command)
            return choice.message.content or "", command.get("command"), tool_call.id

        return choice.message.content or "", None, None

    # ── Streaming ────────────────────────────────────────────────────────────

    def chat_stream(self, messages, use_tools=False):
        """Stream AI response. Yields text chunks. Circuit-breaker on quota errors."""
        model  = self._effective_model(use_tools)
        kwargs = {
            "model": model,
            "messages": messages,
            "stream": True,
            "num_retries": 0,
            "timeout": TIMEOUT_STREAM,
        }
        self._add_ollama_base(kwargs)

        try:
            for chunk in self._stream_once(kwargs, model):
                yield chunk
            return
        except Exception as e:
            print(f"  [AI] Stream error ({type(e).__name__}): {str(e)[:150]}")
            if self._handle_error(e):
                # Fallback activated -> retry with fallback model
                fb = self._effective_model(use_tools)
                kwargs["model"] = fb
                self._add_ollama_base(kwargs)
                print(f"  [AI] Retrying with fallback {fb}...")
                try:
                    for chunk in self._stream_once(kwargs, fb):
                        yield chunk
                    return
                except Exception as e2:
                    print(f"  [AI] Fallback retry also failed: {e2}")
                    raise

            if _is_quota_error(e):
                raise  # no fallback available, propagate
            if isinstance(e, TimeoutError) or _is_timeout_error(e):
                raise  # timeouts don't benefit from retry

            # Transient error -> one retry
            try:
                time.sleep(TRANSIENT_DELAY)
                for chunk in self._stream_once(kwargs, model):
                    yield chunk
                return
            except Exception:
                raise e  # raise original

    def _stream_once(self, kwargs, model):
        """Execute a single streaming call. Yields text chunks."""
        t0 = time.time()
        print(f"  [AI] Calling {model} | stream...")

        # Hard timeout on the initial connection — this is where hangs happen.
        # Once streaming starts, chunks flow on their own.
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(litellm.completion, **kwargs)
            try:
                response = future.result(timeout=TIMEOUT_STREAM + 5)
            except FuturesTimeout:
                future.cancel()
                raise TimeoutError(f"AI stream to {model} timed out after {TIMEOUT_STREAM}s")

        for chunk in response:
            delta = chunk.choices[0].delta
            if delta and delta.content:
                yield delta.content
        elapsed = time.time() - t0
        print(f"  [AI] {model} | stream | {elapsed:.1f}s")

        if self.health.status != ModelHealth.HEALTHY:
            if model in (self.tool_model, self.answer_model):
                self.health.set_healthy()

    # ── Transient retry helper ───────────────────────────────────────────────

    def _retry_transient(self, fn, original_error):
        """Retry a callable up to TRANSIENT_RETRIES times for non-quota errors."""
        for attempt in range(TRANSIENT_RETRIES):
            time.sleep(TRANSIENT_DELAY)
            print(f"  [AI] Transient retry {attempt + 1}/{TRANSIENT_RETRIES}")
            try:
                return fn()
            except Exception as e:
                if _is_quota_error(e):
                    if self._handle_error(e):
                        return fn()
                    raise
                original_error = e
        raise original_error
