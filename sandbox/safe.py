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
    # /proc and /sys are restricted to a whitelist of files that are safe
    # to read. Broad "cat /proc/" would allow leaking env vars via
    # /proc/self/environ or credentials via /proc/<pid>/environ.
    "cat /etc/os-release", "cat /etc/hostname",
    "cat /proc/cpuinfo", "cat /proc/meminfo", "cat /proc/loadavg",
    "cat /proc/version", "cat /proc/uptime", "cat /proc/stat",
    "netstat", "ss ", "ping ",
    "hostname", "ip addr", "ip a", "ifconfig",
    "systemctl status", "systemctl list-units",
    "terraform show", "terraform state list",
    "aws sts", "aws s3 ls", "gcloud config", "az account",
    "ollama list", "ollama ps", "ollama show",
    "uname", "lscpu", "lsblk", "lsof",
    "journalctl", "dmesg",
    "strace -p", "ltrace",
    "top -b", "htop", "vmstat", "iostat", "sar", "mpstat", "pidstat",
    "ls ", "ls\t", "find /var/log", "find /tmp",
    "tail ", "head ", "wc ", "grep ", "awk ", "sed ",
    "nslookup", "dig ", "traceroute", "tracepath",
    "nc -z", "telnet",
    "iptables -L", "ip route", "ip link", "nmap -sn",
    "du ", "blkid", "mount", "stat ",
    "which ", "type ",
    "id", "whoami", "w ", "who ", "last ", "history",
    # NOTE: `curl`, `env`, `printenv`, broad `cat /proc/`, and broad `cat /sys/`
    # are intentionally NOT allowed. They enable credential exfiltration —
    # curl can reach cloud-metadata endpoints (169.254.169.254) and env dumps
    # leak AZIRO_API_KEY and injected cloud credentials.
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
