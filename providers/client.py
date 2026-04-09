"""
providers/client.py — AI provider layer using LiteLLM with native tool calling.
Same approach as kubectl-ai's gollm/ — proper tool protocol, no regex.

Two-model setup (optional):
  TOOL_MODEL   — fast model for deciding which commands to run
  ANSWER_MODEL — smarter model for writing the final analysis

Examples:
  AI_MODEL=ollama/llama3.1:8b python3 main.py
  TOOL_MODEL=ollama/llama3.1:8b ANSWER_MODEL=ollama/gemma3 python3 main.py
  AI_MODEL=claude-haiku-4-5-20251001 python3 main.py
"""
import os
import json
import time
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


class LLMClient:
    """
    Wraps LiteLLM — mirrors gollm.Client in kubectl-ai.

    Attributes
    ----------
    tool_model   : model used when tool calling is enabled  (fast)
    answer_model : model used for final streaming answer    (smart)
    """

    def __init__(self):
        _default          = os.environ.get("AI_MODEL", "ollama/llama3.1:8b")
        self.tool_model   = os.environ.get("TOOL_MODEL",   _default)
        self.answer_model = os.environ.get("ANSWER_MODEL", self.tool_model)

    # ── non-streaming ────────────────────────────────────────────────────────

    def chat(self, messages, use_tools=True):
        """
        Send messages to AI with automatic retry on failure.
        Mirrors gollm/factory.go retryChat — attempts 1/2/3 with 10s/20s/60s backoff.
        Returns (reply_text, command_or_None, tool_call_id_or_None).
        """
        delays    = [0, 10, 20, 60]
        last_err  = None
        for attempt, delay in enumerate(delays):
            if delay:
                print(f"  [AI] retry {attempt}/{len(delays)-1} — waiting {delay}s...")
                time.sleep(delay)
            try:
                return self._chat_once(messages, use_tools)
            except Exception as e:
                last_err = e
                if attempt < len(delays) - 1:
                    print(f"  [AI] attempt {attempt+1} failed: {e}")
        raise last_err

    def _chat_once(self, messages, use_tools):
        """Single (non-retried) AI call."""
        model  = self.tool_model if use_tools else self.answer_model
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
        model    = self.tool_model if use_tools else self.answer_model
        kwargs   = {"model": model, "messages": messages, "stream": True}
        t0       = time.time()
        response = litellm.completion(**kwargs)
        for chunk in response:
            delta = chunk.choices[0].delta
            if delta and delta.content:
                yield delta.content
        elapsed = time.time() - t0
        print(f"  [AI] {model} | stream | {elapsed:.1f}s")
