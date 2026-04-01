"""
tools/terraform.py — execute Terraform commands in a workspace directory.
"""
from .base import run_command


def run_terraform(config, command):
    workspace = config.get("workspace", ".")
    return run_command(command, timeout=60)
