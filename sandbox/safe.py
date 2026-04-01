"""
sandbox/safe.py — whitelist-based read-only command filter.
"""
from tools.base import run_command

SAFE_PREFIXES = [
    "kubectl get", "kubectl describe", "kubectl logs", "kubectl top",
    "kubectl explain", "kubectl version", "kubectl cluster-info",
    "docker ps", "docker images", "docker logs", "docker stats", "docker inspect",
    "helm list", "helm status", "helm history", "helm get",
    "git status", "git log", "git branch", "git diff", "git show",
    "df ", "free ", "ps ", "uptime",
    "cat /etc/os-release", "cat /etc/hostname", "cat /proc/cpuinfo", "cat /proc/meminfo",
    "netstat", "ss ", "curl ", "ping ",
    "hostname", "ip addr", "ip a", "ifconfig",
    "systemctl status", "systemctl list-units",
    "terraform show", "terraform state list",
    "aws sts", "aws s3 ls", "gcloud config", "az account",
    "ollama list", "ollama ps", "ollama show",
    "uname", "lscpu", "lsblk", "lsof",
    "journalctl", "dmesg",
    "strace -p", "ltrace",
    "top -b", "htop", "vmstat", "iostat", "sar", "mpstat", "pidstat",
    "cat /proc/", "cat /sys/",
    "ls ", "ls\t", "find /var/log", "find /tmp",
    "tail ", "head ", "wc ", "grep ", "awk ", "sed ",
    "nslookup", "dig ", "traceroute", "tracepath",
    "nc -z", "telnet",
    "iptables -L", "ip route", "ip link", "nmap -sn",
    "du ", "blkid", "mount", "stat ",
    "env", "printenv", "which ", "type ",
    "id", "whoami", "w ", "who ", "last ", "history",
]

BLOCKED_KEYWORDS = [
    "rm ", "rmdir", "mv ", "dd ", "mkfs", "fdisk",
    "/usr/local/bin/", "/usr/bin/ollama", "/bin/ollama",
    "kubectl delete", "kubectl apply", "kubectl create",
    "kubectl patch", "kubectl edit", "kubectl scale", "kubectl rollout restart",
    "docker rm", "docker rmi", "docker stop", "docker kill",
    "helm uninstall", "helm install", "helm upgrade",
    "git push", "git reset", "git checkout",
    "> /", "| tee /", "sudo ",
]


def is_safe(command):
    cmd = command.strip().lower()
    for blocked in BLOCKED_KEYWORDS:
        if blocked.lower() in cmd:
            return False, f"Blocked keyword: '{blocked}'"
    for safe in SAFE_PREFIXES:
        safe_lower = safe.strip().lower()
        if cmd == safe_lower or cmd.startswith(safe_lower + " ") or cmd.startswith(safe_lower + "\t"):
            return True, "ok"
    return False, "Command not in safe whitelist"


def run_safe(command):
    safe, reason = is_safe(command)
    if not safe:
        return f"[SANDBOX BLOCKED] {reason}\nCommand: {command}\nTo allow this, set SANDBOX=local"
    return run_command(command)
