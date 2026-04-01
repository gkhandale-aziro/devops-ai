"""
prompts/builder.py — load system prompt template and optionally inject live cluster context.
"""
import os
from tools.base import run_command

_PROMPT_FILE = os.path.join(os.path.dirname(__file__), "system_prompt.txt")

with open(_PROMPT_FILE, "r", encoding="utf-8") as _f:
    SYSTEM = _f.read().strip()


def build_system_prompt():
    """Build system prompt with live cluster context appended."""
    pods = run_command("kubectl get pods -A 2>/dev/null || echo 'kubectl not available'")
    return SYSTEM + f"\n\nCURRENT PODS ON THIS CLUSTER:\n{pods}"
