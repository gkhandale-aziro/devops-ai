"""
tools/azure.py — execute Azure CLI commands with optional subscription.
"""
from .base import run_command


def run_azure(config, command):
    subscription = config.get("subscription", "")
    if subscription and "az " in command and "--subscription" not in command:
        command += f" --subscription {subscription}"
    return run_command(command)
