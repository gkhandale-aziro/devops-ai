"""
tools/ssh.py — execute commands on remote servers via SSH (paramiko).
"""
from .base import MAX_OUTPUT_CHARS


def _truncate(text):
    if len(text) > MAX_OUTPUT_CHARS:
        return text[:MAX_OUTPUT_CHARS] + "\n... [truncated]"
    return text


def run_ssh(config, command):
    """SSH into a remote server and run a command. Supports password, key, and key+passphrase auth."""
    try:
        import paramiko
    except ImportError:
        return "[ERROR] paramiko not installed. Run: pip3 install paramiko"

    host           = config.get("host", "")
    user           = config.get("user", "root")
    port           = int(config.get("port", 22))
    password       = config.get("password", "")
    key_path       = config.get("key_path", "")
    key_passphrase = config.get("key_passphrase", "")

    if not host:
        return "[ERROR] No host configured"

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    connect_kwargs = dict(hostname=host, port=port, username=user, timeout=10)
    if password:
        connect_kwargs["password"]      = password
        connect_kwargs["look_for_keys"] = False
    elif key_path:
        connect_kwargs["key_filename"] = key_path
        if key_passphrase:
            connect_kwargs["passphrase"] = key_passphrase
    else:
        connect_kwargs["look_for_keys"] = True

    last_error = None
    for attempt in range(2):  # 1 retry on connection drop
        try:
            ssh.connect(**connect_kwargs)
            _, stdout, stderr = ssh.exec_command(command, timeout=30)
            out    = stdout.read().decode("utf-8", errors="replace")
            err    = stderr.read().decode("utf-8", errors="replace")
            output = out + err if out else err
            return _truncate(output or "[No output]")
        except Exception as e:
            last_error = e
            ssh.close()
    return f"[SSH ERROR] {last_error}"
