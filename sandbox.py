"""
sandbox.py — command execution with isolation
Three modes:
  safe   : whitelist of read-only commands only (default)
  docker : run commands inside a Docker container
  local  : run directly on host (no isolation)

Set with env var: SANDBOX=safe | docker | local
"""
import os
import shlex
from tools import run_command

SANDBOX_MODE = os.environ.get("SANDBOX", "safe")

# ── Whitelist of safe read-only commands ─────────────────────────────────────
SAFE_PREFIXES = [
    "kubectl get", "kubectl describe", "kubectl logs", "kubectl top",
    "kubectl explain", "kubectl version", "kubectl cluster-info",
    "docker ps", "docker images", "docker logs", "docker stats",
    "docker inspect",
    "helm list", "helm status", "helm history", "helm get",
    "git status", "git log", "git branch", "git diff", "git show",
    "df ", "free ", "ps ", "uptime",
    "cat /etc/os-release", "cat /etc/hostname", "cat /proc/cpuinfo",
    "cat /proc/meminfo",
    "netstat", "ss ", "curl ", "ping ",
    "hostname", "ip addr", "ip a", "ifconfig",
    "systemctl status", "systemctl list-units",
    "terraform show", "terraform state list",
    "aws sts", "aws s3 ls", "gcloud config", "az account",
    "ollama list", "ollama ps", "ollama show",
    "uname", "lscpu", "lsblk", "lsof",
    # Debug — logs and system events
    "journalctl", "dmesg",
    # Debug — process and resource tracing
    "strace -p", "ltrace",
    "top -b", "htop",
    "vmstat", "iostat", "sar",
    "mpstat", "pidstat",
    # Debug — file and path inspection
    "cat /proc/", "cat /sys/",
    "ls ", "ls\t", "find /var/log", "find /tmp",
    "tail ", "head ", "wc ",
    "grep ", "awk ", "sed ",
    # Debug — network
    "nslookup", "dig ", "traceroute", "tracepath",
    "nc -z", "telnet",
    "iptables -L", "ip route", "ip link",
    "nmap -sn",
    # Debug — disk and files
    "du ", "lsblk", "blkid", "mount",
    "stat ",
    # Debug — environment
    "env", "printenv", "which ", "type ",
    "id", "whoami", "w ", "who ",
    "last ", "history",
]

BLOCKED_KEYWORDS = [
    "rm ", "rmdir", "mv ", "dd ", "mkfs", "fdisk",
    "/usr/local/bin/", "/usr/bin/ollama", "/bin/ollama",
    "kubectl delete", "kubectl apply", "kubectl create",
    "kubectl patch", "kubectl edit", "kubectl scale",
    "kubectl rollout restart",
    "docker rm", "docker rmi", "docker stop", "docker kill",
    "helm uninstall", "helm install", "helm upgrade",
    "git push", "git reset", "git checkout",
    "> /", "| tee /", "sudo ",
]

SANDBOX_IMAGE = os.environ.get("SANDBOX_IMAGE", "bitnami/kubectl:latest")


def is_safe(command):
    """Check if command is in the safe whitelist."""
    # Lowercase both sides to prevent case-bypass (e.g. "RM -rf /")
    cmd = command.strip().lower()
    for blocked in BLOCKED_KEYWORDS:
        if blocked.lower() in cmd:
            return False, f"Blocked keyword: '{blocked}'"
    for safe in SAFE_PREFIXES:
        # Strip trailing spaces so "df " and "df" both work correctly
        safe_lower = safe.strip().lower()
        # Require the prefix to be followed by a space or end of string
        # This prevents "df" from matching "dff" or "free" from matching "freedom"
        if cmd == safe_lower or cmd.startswith(safe_lower + " ") or cmd.startswith(safe_lower + "\t"):
            return True, "ok"
    return False, "Command not in safe whitelist"


def run_safe(command):
    """Run command only if it is in the safe whitelist."""
    safe, reason = is_safe(command)
    if not safe:
        return f"[SANDBOX BLOCKED] {reason}\nCommand: {command}\nTo allow this, set SANDBOX=local"
    return run_command(command)  # includes timeout and output truncation


def run_docker(command):
    """Run command inside a Docker container for full isolation."""
    # shlex.quote prevents shell injection from special characters in the command
    escaped = shlex.quote(command)
    docker_cmd = f"docker run --rm --network host -v ~/.kube:/root/.kube {SANDBOX_IMAGE} sh -c {escaped}"
    return run_command(docker_cmd)


def run_local(command):
    """Run command directly on host — no isolation."""
    return run_command(command)  # includes timeout and output truncation


def execute(command):
    """Execute command in the configured sandbox mode."""
    if SANDBOX_MODE == "docker":
        return run_docker(command)
    elif SANDBOX_MODE == "local":
        return run_local(command)
    else:
        return run_safe(command)
