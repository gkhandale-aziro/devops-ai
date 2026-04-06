"""
tools/terraform.py — execute Terraform commands in a workspace directory.
"""
from .base import run_command


def run_terraform(config, command):
    workspace = config.get("workspace", "").strip()

    # Terraform >= 0.14 supports -chdir to run in a different directory
    if workspace and workspace != ".":
        if "terraform " in command and "-chdir" not in command:
            command = command.replace("terraform ", f"terraform -chdir={workspace} ", 1)

    return run_command(command, timeout=60)
