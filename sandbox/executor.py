"""
sandbox/executor.py — dispatcher: routes to safe / docker / local based on SANDBOX env var.
"""
import os
from .safe          import run_safe
from .docker_sandbox import run_docker_sandbox
from tools.base     import run_command


class Sandbox:
    """
    Executes commands in the configured sandbox mode.
    Mode is read from the SANDBOX environment variable (default: safe).
    """

    def __init__(self):
        self.mode = os.environ.get("SANDBOX", "safe")

    def execute(self, command):
        """Execute command in the configured sandbox mode."""
        if self.mode == "docker":
            return run_docker_sandbox(command)
        elif self.mode == "local":
            return run_command(command)
        else:
            return run_safe(command)
