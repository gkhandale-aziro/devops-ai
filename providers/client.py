"""
providers/client.py — Production-grade AI provider layer.

Supports all major AI providers via their native SDKs:
  - Ollama:    OpenAI SDK → localhost/v1 (free, local)
  - Gemini:    OpenAI SDK → Google's OpenAI-compatible endpoint
  - OpenAI:    OpenAI SDK (native)
  - Anthropic: Anthropic SDK (native Messages API)

Two-model setup (optional):
  TOOL_MODEL   — fast model for deciding which commands to run
  ANSWER_MODEL — smarter model for writing the final analysis

Resilience:
  - Circuit breaker: instant failover on quota/rate-limit (no retries on 429)
  - Hard timeouts on every API call
  - Auto-fallback to Ollama when cloud model is exhausted
  - Background health monitor (probes primary every 30 min)
  - Auto-recovery: switches back when primary is healthy again
  - Exposes health state for UI banners via ModelHealth

Examples:
  AI_MODEL=ollama/qwen2.5:7b python3 main.py
  TOOL_MODEL=ollama/qwen2.5:3b ANSWER_MODEL=ollama/qwen2.5:14b python3 main.py
"""
import os
import json
import time
import threading
import functools
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from openai import OpenAI

try:
    from openai import APITimeoutError as _OpenAITimeout
except ImportError:
    _OpenAITimeout = None

try:
    import anthropic as _anthropic_mod
    from anthropic import APITimeoutError as _AnthropicTimeout
except ImportError:
    _anthropic_mod = None
    _AnthropicTimeout = None

from observability import record_fallback, record_llm_call


# SDK timeouts (OpenAI, Anthropic) do NOT inherit from built-in TimeoutError,
# so naive isinstance(exc, TimeoutError) misses them. This tuple captures
# every timeout we might see from our providers.
_TIMEOUT_TYPES: tuple = tuple(
    t for t in (TimeoutError, _OpenAITimeout, _AnthropicTimeout) if t is not None
)


def _is_timeout(exc: Exception) -> bool:
    return isinstance(exc, _TIMEOUT_TYPES)

# Force unbuffered output so Docker logs show [AI] lines immediately
print = functools.partial(print, flush=True)


def _classify_llm_error(exc: Exception) -> str:
    """Map an exception to a Prometheus `outcome` label — bounded set only."""
    if _is_quota_error(exc):
        return "quota"
    if _is_timeout(exc):
        return "timeout"
    return "error"

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
TIMEOUT_STREAM  = 120  # seconds — streaming (Ollama on CPU can be slow)
TIMEOUT_PROBE   = 10   # seconds — health probe / recovery ping

# ── Provider routing ─────────────────────────────────────────────────────────

def _parse_model(model: str) -> tuple[str, str]:
    """Split 'provider/model-name' → (provider, model_name)."""
    if "/" in model:
        return model.split("/")[0], model.split("/", 1)[1]
    return "ollama", model


def _call_api(model: str, messages: list, *, stream: bool = False,
              tools: list | None = None, max_tokens: int | None = None):
    """
    Unified API call that routes to the right provider.
    Returns a response object (OpenAI format) or a stream.
    Anthropic responses are converted to OpenAI format for consistency.
    """
    provider, model_name = _parse_model(model)

    if provider == "anthropic":
        return _call_anthropic(model_name, messages, stream=stream,
                               tools=tools, max_tokens=max_tokens)

    # All other providers use OpenAI SDK
    base_url, api_key = _get_openai_config(provider)
    client = OpenAI(base_url=base_url, api_key=api_key, timeout=TIMEOUT_STREAM)

    kwargs: dict = {"model": model_name, "messages": messages, "stream": stream}
    if tools:
        kwargs["tools"] = tools
    if max_tokens:
        kwargs["max_tokens"] = max_tokens

    return client.chat.completions.create(**kwargs)


def _get_openai_config(provider: str) -> tuple[str, str]:
    """Return (base_url, api_key) for OpenAI-compatible providers."""
    if provider == "ollama":
        base = _get_ollama_base()
        if not base:
            raise ValueError("Ollama not reachable. Check OLLAMA_API_BASE or start Ollama.")
        return base.rstrip("/") + "/v1", "ollama"
    elif provider == "gemini":
        key = os.environ.get("GEMINI_API_KEY", "")
        if not key:
            raise ValueError("Set GEMINI_API_KEY environment variable")
        return "https://generativelanguage.googleapis.com/v1beta/openai/", key
    elif provider == "openai":
        key = os.environ.get("OPENAI_API_KEY", "")
        if not key:
            raise ValueError("Set OPENAI_API_KEY environment variable")
        return "https://api.openai.com/v1", key
    else:
        raise ValueError(f"Unknown provider: {provider}. Use: ollama/, gemini/, openai/, anthropic/")


# ── Anthropic adapter ────────────────────────────────────────────────────────

def _call_anthropic(model_name: str, messages: list, *, stream: bool = False,
                    tools: list | None = None, max_tokens: int | None = None):
    """Call Anthropic Messages API, return OpenAI-compatible response."""
    if not _anthropic_mod:
        raise ImportError("pip install anthropic")

    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise ValueError("Set ANTHROPIC_API_KEY environment variable")

    client = _anthropic_mod.Anthropic(api_key=key, timeout=TIMEOUT_STREAM)

    # Extract system message
    system = ""
    chat_msgs = []
    for m in messages:
        if m["role"] == "system":
            system = m["content"]
        else:
            chat_msgs.append({"role": m["role"], "content": m["content"]})

    # Convert OpenAI tools format → Anthropic tools format
    anthropic_tools = None
    if tools:
        anthropic_tools = []
        for t in tools:
            fn = t["function"]
            anthropic_tools.append({
                "name": fn["name"],
                "description": fn["description"],
                "input_schema": fn["parameters"],
            })

    kwargs: dict = {
        "model": model_name,
        "messages": chat_msgs,
        "max_tokens": max_tokens or 4096,
    }
    if system:
        kwargs["system"] = system
    if anthropic_tools:
        kwargs["tools"] = anthropic_tools

    if stream:
        return _anthropic_stream(client, kwargs)

    response = client.messages.create(**kwargs)
    return _anthropic_to_openai(response)


def _anthropic_to_openai(response):
    """Convert Anthropic response to OpenAI-compatible format."""
    from types import SimpleNamespace

    content = ""
    tool_calls = []
    for block in response.content:
        if block.type == "text":
            content += block.text
        elif block.type == "tool_use":
            tc = SimpleNamespace(
                id=block.id,
                function=SimpleNamespace(
                    name=block.name,
                    arguments=json.dumps(block.input),
                ),
            )
            tool_calls.append(tc)

    message = SimpleNamespace(
        content=content,
        tool_calls=tool_calls if tool_calls else None,
    )
    choice = SimpleNamespace(message=message)
    usage = SimpleNamespace(
        total_tokens=(response.usage.input_tokens + response.usage.output_tokens)
        if response.usage else 0,
    )
    return SimpleNamespace(choices=[choice], usage=usage)


def _anthropic_stream(client, kwargs):
    """Yield OpenAI-compatible stream chunks from Anthropic streaming."""
    from types import SimpleNamespace

    with client.messages.stream(**kwargs) as stream:
        for text in stream.text_stream:
            delta = SimpleNamespace(content=text)
            choice = SimpleNamespace(delta=delta)
            yield SimpleNamespace(choices=[choice])


# ── Quota / rate-limit error detection ───────────────────────────────────────

_QUOTA_KEYWORDS = [
    "quota", "rate_limit", "rate limit", "429", "resource_exhausted",
    "ResourceExhausted", "exceeded", "too many requests", "billing",
    "insufficient_quota", "RateLimitError",
]


def _is_quota_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(kw.lower() in msg for kw in _QUOTA_KEYWORDS)


def _is_timeout_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(kw in msg for kw in ["timeout", "timed out", "deadline"])


# ── Ollama model discovery ───────────────────────────────────────────────────

_PREFERRED_TOOL_FALLBACKS = [
    "qwen2.5:7b", "qwen2.5:3b", "llama3.1:8b",
    "gemma3:latest", "llama3.2:latest",
]

_PREFERRED_ANSWER_FALLBACKS = [
    "qwen2.5:14b", "qwen2.5:7b", "llama3.1:8b",
    "gemma3:latest", "mixtral:8x7b",
]


def _get_ollama_base() -> str:
    """Return the working Ollama API base URL, or empty string."""
    import urllib.request

    urls_to_try = []
    configured = os.environ.get("OLLAMA_API_BASE", "")
    if configured:
        urls_to_try.append(configured)
    for fb in ["http://host.docker.internal:11434", "http://localhost:11434"]:
        if fb not in urls_to_try:
            urls_to_try.append(fb)

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
    """Return available Ollama model names."""
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
    for preferred in preference:
        if preferred in available:
            return preferred
    return available[0] if available else ""


# ── Model health state ───────────────────────────────────────────────────────

class ModelHealth:
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
                self.fallback_model = (
                    self.fallback_tool if self.fallback_tool == self.fallback_answer
                    else f"{self.fallback_tool} / {self.fallback_answer}"
                )
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


# ── Config persistence ──────────────────────────────────────────────────────

_CONFIG_FILE = os.path.join(
    os.environ.get("AZIRO_DATA_DIR", os.path.dirname(__file__)),
    "model_config.json",
)


def _load_config() -> dict:
    try:
        with open(_CONFIG_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_config(data: dict):
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
    models = []
    for env_key, model_list in _CLOUD_MODELS.items():
        if os.environ.get(env_key):
            models.extend(model_list)
    return models


# ── LLM Client ──────────────────────────────────────────────────────────────

RECOVERY_INTERVAL = 1800  # 30 min between recovery probes
TRANSIENT_RETRIES = 2
TRANSIENT_DELAY   = 3


class LLMClient:
    """
    Production-grade LLM client with circuit-breaker failover.
    Uses OpenAI SDK with provider-specific base_url for each model.
    """

    def __init__(self):
        saved = _load_config()
        if saved.get("ollama_api_base"):
            os.environ["OLLAMA_API_BASE"] = saved["ollama_api_base"]

        # Priority: saved config > env vars > auto-discover
        if saved.get("tool_model"):
            self.tool_model = saved["tool_model"]
            self.answer_model = saved.get("answer_model", self.tool_model)
        elif os.environ.get("AI_MODEL") or os.environ.get("TOOL_MODEL"):
            _default = os.environ.get("AI_MODEL", "ollama/llama3.1:8b")
            self.tool_model = os.environ.get("TOOL_MODEL", _default)
            self.answer_model = os.environ.get("ANSWER_MODEL", self.tool_model)
        else:
            self.tool_model, self.answer_model = self._auto_select_best()

        self.health = ModelHealth()
        self.health.primary_tool = self.tool_model
        self.health.primary_answer = self.answer_model
        self._monitor_thread: threading.Thread | None = None
        self._monitor_stop = threading.Event()

        print(f"  [AI] Provider: OpenAI SDK (direct)")
        print(f"  [AI] Tool model:   {self.tool_model}")
        print(f"  [AI] Answer model: {self.answer_model}")

    @staticmethod
    def _auto_select_best() -> tuple[str, str]:
        """Pick the best available model. Ollama first (free), cloud as bonus."""
        # 1. Try Ollama first — always free, always available
        ollama_models = _discover_ollama_models()
        if ollama_models:
            tool = f"ollama/{_pick_best_fallback(ollama_models, _PREFERRED_TOOL_FALLBACKS)}"
            answer = f"ollama/{_pick_best_fallback(ollama_models, _PREFERRED_ANSWER_FALLBACKS)}"
            print(f"  [AI] Auto-selected Ollama: tool={tool} answer={answer}")
            return tool, answer

        # 2. Try cloud models if no Ollama
        _CLOUD_PRIORITY = [
            ("GEMINI_API_KEY",    "gemini/gemini-2.5-flash"),
            ("OPENAI_API_KEY",    "openai/gpt-4o-mini"),
            ("ANTHROPIC_API_KEY", "anthropic/claude-haiku-4-20250414"),
        ]
        for env_key, model in _CLOUD_PRIORITY:
            if os.environ.get(env_key):
                print(f"  [AI] Testing {model}...")
                try:
                    _call_api(model,
                             [{"role": "user", "content": "ping"}],
                             max_tokens=5)
                    print(f"  [AI] Auto-selected: {model}")
                    return model, model
                except Exception as e:
                    print(f"  [AI] {model} unavailable: {str(e)[:100]}")

        print("  [AI] No models found — defaulting to ollama/llama3.1:8b")
        return "ollama/llama3.1:8b", "ollama/llama3.1:8b"

    def switch_model(self, tool_model: str | None = None,
                     answer_model: str | None = None,
                     ai_model: str | None = None) -> dict:
        if ai_model:
            tool_model = ai_model
            answer_model = ai_model
        if tool_model:
            self.tool_model = tool_model
        if answer_model:
            self.answer_model = answer_model

        self.health.primary_tool = self.tool_model
        self.health.primary_answer = self.answer_model
        self.health.set_healthy()
        print(f"  [AI] Model switched: tool={self.tool_model} answer={self.answer_model}")

        saved = _load_config()
        saved["tool_model"] = self.tool_model
        saved["answer_model"] = self.answer_model
        _save_config(saved)
        return {"tool_model": self.tool_model, "answer_model": self.answer_model}

    @staticmethod
    def test_model(model: str) -> dict:
        """Quick test if a model is reachable."""
        try:
            _call_api(model,
                      [{"role": "user", "content": "ping"}],
                      max_tokens=5)
            return {"ok": True, "error": ""}
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}

    @staticmethod
    def set_ollama_url(url: str) -> dict:
        url = url.rstrip("/")
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

    # ── Health monitor ───────────────────────────────────────────────────────

    def start_health_monitor(self):
        if self._monitor_thread and self._monitor_thread.is_alive():
            return
        self._monitor_stop.clear()
        self._monitor_thread = threading.Thread(
            target=self._health_monitor_loop, daemon=True, name="ai-health-monitor"
        )
        self._monitor_thread.start()
        print(f"  [AI] Health monitor started (checks every {RECOVERY_INTERVAL}s)")

    def stop_health_monitor(self):
        self._monitor_stop.set()

    def _health_monitor_loop(self):
        while not self._monitor_stop.wait(timeout=RECOVERY_INTERVAL):
            if self.health.status in (ModelHealth.FALLBACK, ModelHealth.UNAVAILABLE):
                self._try_recovery()

    # ── Model routing ────────────────────────────────────────────────────────

    def _effective_model(self, use_tools: bool) -> str:
        if self.health.status == ModelHealth.FALLBACK:
            if use_tools and self.health.fallback_tool:
                return self.health.fallback_tool
            if not use_tools and self.health.fallback_answer:
                return self.health.fallback_answer
        return self.tool_model if use_tools else self.answer_model

    # ── Recovery ─────────────────────────────────────────────────────────────

    def _try_recovery(self) -> bool:
        now = time.time()
        if now - self.health.last_recovery_check < RECOVERY_INTERVAL:
            return False
        self.health.last_recovery_check = now

        print(f"  [AI] Recovery probe — testing {self.tool_model}...")
        result = self.test_model(self.tool_model)
        if result["ok"]:
            print(f"  [AI] Recovery OK — switching back to {self.tool_model}")
            self.health.set_healthy()
            return True
        print(f"  [AI] Recovery failed: {result['error'][:80]}")
        return False

    # ── Fallback activation ──────────────────────────────────────────────────

    def _activate_fallback(self, error: Exception, failing_model: str | None = None):
        # Classify BEFORE consuming the exception — bounded enum for metrics.
        reason = _classify_llm_error(error)
        # Which primary actually failed? Non-tool calls can fail on answer_model;
        # default to tool_model so legacy callers still get a value.
        from_model = failing_model or self.tool_model
        ollama_models = _discover_ollama_models()
        if ollama_models:
            tool_fb = _pick_best_fallback(ollama_models, _PREFERRED_TOOL_FALLBACKS)
            answer_fb = _pick_best_fallback(ollama_models, _PREFERRED_ANSWER_FALLBACKS)
            print(f"  [AI] Quota exhausted — fallback: ollama/{tool_fb} (tools), ollama/{answer_fb} (answer)")
            self.health.set_degraded(
                str(error),
                fallback_tool=f"ollama/{tool_fb}",
                fallback_answer=f"ollama/{answer_fb}",
            )
            record_fallback(
                from_model=from_model,
                to_model=f"ollama/{tool_fb}",
                reason=reason,
            )
        else:
            print(f"  [AI] Quota exhausted — no Ollama available")
            self.health.set_degraded(str(error))
            record_fallback(
                from_model=from_model,
                to_model="none",
                reason=reason,
            )

    def _handle_error(self, error: Exception, failing_model: str | None = None) -> bool:
        if _is_quota_error(error) or _is_timeout(error):
            if self.health.status == ModelHealth.HEALTHY:
                self._activate_fallback(error, failing_model=failing_model)
            return self.health.status == ModelHealth.FALLBACK
        return False

    # ── Non-streaming ────────────────────────────────────────────────────────

    def chat(self, messages, use_tools=True):
        """Returns (reply_text, command_or_None, tool_call_id_or_None)."""
        try:
            return self._chat_once(messages, use_tools)
        except Exception as e:
            print(f"  [AI] Chat error ({type(e).__name__}): {str(e)[:150]}")
            if self._handle_error(e, failing_model=self._effective_model(use_tools)):
                return self._chat_once(messages, use_tools)
            if _is_quota_error(e):
                raise
            return self._retry_transient(
                lambda: self._chat_once(messages, use_tools), e,
                failing_model=self._effective_model(use_tools),
            )

    def _chat_once(self, messages, use_tools):
        model = self._effective_model(use_tools)

        t0 = time.time()
        outcome = "ok"
        prompt_toks = completion_toks = total_toks = 0
        print(f"  [AI] Calling {model} | tools={'yes' if use_tools else 'no'}...")

        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(
                    _call_api, model, messages,
                    tools=TOOLS if use_tools else None,
                )
                try:
                    response = future.result(timeout=TIMEOUT_CHAT + 5)
                except FuturesTimeout:
                    future.cancel()
                    raise TimeoutError(f"AI call to {model} timed out after {TIMEOUT_CHAT}s")

            elapsed = time.time() - t0
            choice = response.choices[0]
            usage = response.usage
            if usage:
                prompt_toks = getattr(usage, "prompt_tokens", 0) or 0
                completion_toks = getattr(usage, "completion_tokens", 0) or 0
                total_toks = getattr(usage, "total_tokens", 0) or 0
            print(f"  [AI] {model} | {elapsed:.1f}s | tokens={total_toks or '?'}")

            if self.health.status != ModelHealth.HEALTHY:
                if model in (self.tool_model, self.answer_model):
                    self.health.set_healthy()

            if choice.message.tool_calls:
                tool_call = choice.message.tool_calls[0]
                args = tool_call.function.arguments
                if isinstance(args, str):
                    args = json.loads(args)
                return choice.message.content or "", args.get("command"), tool_call.id

            return choice.message.content or "", None, None
        except Exception as e:
            outcome = _classify_llm_error(e)
            raise
        finally:
            # RUN-3: always record — success OR failure. `finally` ensures we
            # don't drop a metric on the error path where it matters most.
            record_llm_call(
                model=model,
                duration_s=time.time() - t0,
                outcome=outcome,
                stream=False,
                prompt_tokens=prompt_toks,
                completion_tokens=completion_toks,
                # Only emit `total` when the provider didn't split prompt/completion
                # (e.g. Anthropic's combined figure) so we don't double-count.
                total_tokens=total_toks if not (prompt_toks or completion_toks) else 0,
            )

    # ── Streaming ────────────────────────────────────────────────────────────

    def chat_stream(self, messages, use_tools=False):
        """Stream AI response. Yields text chunks."""
        model = self._effective_model(use_tools)

        try:
            for chunk in self._stream_once(model, messages):
                yield chunk
            return
        except Exception as e:
            print(f"  [AI] Stream error ({type(e).__name__}): {str(e)[:150]}")
            # Activate fallback so next call uses Ollama
            self._handle_error(e, failing_model=model)
            raise

    def _stream_once(self, model, messages):
        """Single streaming call. Yields text chunks."""
        t0 = time.time()
        outcome = "ok"
        print(f"  [AI] Calling {model} | stream...")

        try:
            stream = _call_api(model, messages, stream=True)

            for chunk in stream:
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    yield delta.content

            elapsed = time.time() - t0
            print(f"  [AI] {model} | stream | {elapsed:.1f}s")

            if self.health.status != ModelHealth.HEALTHY:
                if model in (self.tool_model, self.answer_model):
                    self.health.set_healthy()
        except Exception as e:
            outcome = _classify_llm_error(e)
            raise
        finally:
            # Streaming providers don't surface token counts mid-stream on the
            # OpenAI-compatible SDK path, so we record calls + latency only.
            record_llm_call(
                model=model,
                duration_s=time.time() - t0,
                outcome=outcome,
                stream=True,
            )

    # ── Transient retry helper ───────────────────────────────────────────────

    def _retry_transient(self, fn, original_error, failing_model: str | None = None):
        for attempt in range(TRANSIENT_RETRIES):
            time.sleep(TRANSIENT_DELAY)
            print(f"  [AI] Transient retry {attempt + 1}/{TRANSIENT_RETRIES}")
            try:
                return fn()
            except Exception as e:
                if _is_quota_error(e):
                    if self._handle_error(e, failing_model=failing_model):
                        return fn()
                    raise
                original_error = e
        raise original_error
