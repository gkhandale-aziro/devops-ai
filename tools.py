"""
tools.py — command execution and safety checks
"""
import subprocess
import re

MAX_OUTPUT_CHARS = 3000


def run_command(command, timeout=30):
    """Run a shell command with timeout. Returns combined stdout+stderr."""
    try:
        result = subprocess.run(
            command, shell=True, capture_output=True,
            text=True, timeout=timeout
        )
        # Combine stdout and stderr so AI sees warnings too
        output = result.stdout
        if result.stderr:
            output = output + result.stderr if output else result.stderr
        # Include exit code if command failed and produced no output
        if not output:
            output = f"[Exit code: {result.returncode}]"
    except subprocess.TimeoutExpired:
        output = f"[TIMEOUT] Command took longer than {timeout}s and was stopped: {command}"

    # Truncate long output so AI is not overwhelmed
    if len(output) > MAX_OUTPUT_CHARS:
        output = output[:MAX_OUTPUT_CHARS] + f"\n... [truncated — showing first {MAX_OUTPUT_CHARS} chars]"

    return output


def is_destructive(command):
    """Check if a command modifies or deletes resources."""
    # Pad with spaces so we match whole words, not substrings
    cmd = f" {command} "
    destructive = [
        # Generic dangerous operations
        " delete ", " remove ", " rm ", " drop ", " truncate ",
        " kill ", " destroy ", " reset ", " purge ",
        # Kubernetes write operations
        "kubectl apply", "kubectl create", "kubectl patch",
        "kubectl edit", "kubectl scale", "kubectl rollout restart",
        # Docker write operations
        "docker stop", "docker rm", "docker rmi", "docker kill",
        # Helm write operations
        "helm install", "helm upgrade", "helm uninstall",
        # Git write operations
        "git push", "git reset", "git rebase",
    ]
    return any(w in cmd for w in destructive)
