"""
sandbox/executor.py — dispatcher: routes to safe / docker / local based on SANDBOX env var.
"""
import os
from .safe          import run_safe
from .docker_sandbox import run_docker_sandbox
from tools.base     import run_command

SANDBOX_MODE = os.environ.get("SANDBOX", "safe")


def execute(command):
    """Execute command in the configured sandbox mode."""
    if SANDBOX_MODE == "docker":
        return run_docker_sandbox(command)
    elif SANDBOX_MODE == "local":
        return run_command(command)
    else:
        return run_safe(command)
