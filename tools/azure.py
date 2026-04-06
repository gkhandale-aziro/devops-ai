"""
tools/azure.py — execute Azure CLI commands with optional subscription, resource group, and tenant.
"""
from .base import run_command


def run_azure(config, command):
    subscription   = config.get("subscription", "")
    resource_group = config.get("resource_group", "")
    tenant         = config.get("tenant", "")

    if "az " in command:
        if subscription and "--subscription" not in command:
            command += f" --subscription {subscription}"
        if resource_group and "--resource-group" not in command and "-g " not in command:
            command += f" --resource-group {resource_group}"

    env_parts = []
    if tenant:
        env_parts.append(f"AZURE_TENANT_ID={tenant}")

    prefix = " ".join(env_parts) + " " if env_parts else ""
    return run_command(prefix + command)
