"""
tools/kubectl.py — execute kubectl commands with optional context/kubeconfig.
"""
from .base import run_command


def run_kubernetes(config, command):
    context    = config.get("context", "")
    kubeconfig = config.get("kubeconfig", "")
    prefix     = f"KUBECONFIG={kubeconfig} " if kubeconfig else ""
    if context and "kubectl" in command and "--context" not in command:
        command = command.replace("kubectl ", f"kubectl --context={context} ", 1)
    return run_command(prefix + command)
