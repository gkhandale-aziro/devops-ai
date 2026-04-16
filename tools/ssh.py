"""
tools/ssh.py — execute commands on remote servers via SSH (paramiko).

Host-key verification (SEC-5):
  If the target config contains a "host_key" field, the SSHClient is locked
  to that single pinned key and any mismatch fails the connection (strict
  mode — MITM-safe). If absent, paramiko's AutoAddPolicy is used so existing
  targets keep working; a warning is logged so operators can migrate to
  strict mode via the capture_host_key() helper.
"""
import base64
import hashlib
import logging

from .base import MAX_OUTPUT_CHARS

log = logging.getLogger(__name__)


def _truncate(text):
    if len(text) > MAX_OUTPUT_CHARS:
        return text[:MAX_OUTPUT_CHARS] + "\n... [truncated]"
    return text


def _install_pinned_host_key(ssh, hostname, host_key_line):
    """Load a single pinned key into the SSHClient and switch to strict mode.

    host_key_line is OpenSSH-format minus the hostname: "<keytype> <base64>".
    Returns True on success, False on malformed input.
    """
    import paramiko
    from paramiko.hostkeys import HostKeyEntry

    try:
        entry = HostKeyEntry.from_line(f"{hostname} {host_key_line.strip()}")
    except Exception:
        return False
    if entry is None or entry.key is None:
        return False
    ssh.get_host_keys().add(hostname, entry.key.get_name(), entry.key)
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    return True


def fingerprint(host_key_line):
    """Return the OpenSSH SHA256 fingerprint for a "<keytype> <base64>" line.

    Format matches ssh-keygen -lf: "SHA256:<base64>" with no padding.
    Returns None if the input is malformed.
    """
    try:
        parts = host_key_line.strip().split()
        if len(parts) < 2:
            return None
        raw = base64.b64decode(parts[1])
        digest = hashlib.sha256(raw).digest()
        return "SHA256:" + base64.b64encode(digest).rstrip(b"=").decode("ascii")
    except Exception:
        return None


def capture_host_key(config):
    """Open a transport-only connection to read the server's host key.

    Intended for an explicit "trust this host" flow — the caller should show
    the fingerprint to the operator for out-of-band confirmation before
    persisting the returned line into the target's config as "host_key".

    Returns "<keytype> <base64>" on success, or "[SSH ERROR] ..." on failure.
    """
    try:
        import paramiko
    except ImportError:
        return "[ERROR] paramiko not installed"

    host = config.get("host", "")
    port = int(config.get("port", 22))
    if not host:
        return "[ERROR] No host configured"

    t = None
    try:
        t = paramiko.Transport((host, port))
        t.start_client(timeout=10)
        key = t.get_remote_server_key()
        return f"{key.get_name()} {key.get_base64()}"
    except Exception as e:
        return f"[SSH ERROR] {e}"
    finally:
        if t is not None:
            try:
                t.close()
            except Exception:
                pass


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
    host_key       = config.get("host_key", "")

    if not host:
        return "[ERROR] No host configured"

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
        ssh = paramiko.SSHClient()
        if host_key:
            if not _install_pinned_host_key(ssh, host, host_key):
                return "[SSH ERROR] malformed host_key in target config"
        else:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            log.warning("ssh.host_key_unverified", extra={"host": host})
        try:
            ssh.connect(**connect_kwargs)
            _, stdout, stderr = ssh.exec_command(command, timeout=30)
            out    = stdout.read().decode("utf-8", errors="replace")
            err    = stderr.read().decode("utf-8", errors="replace")
            output = out + err if out else err
            return _truncate(output or "[No output]")
        except paramiko.BadHostKeyException as e:
            # Strict mode caught a mismatch — do NOT retry, this is an attack
            # signal or a legitimate key rotation that requires operator action.
            return f"[SSH ERROR] host key verification failed: {e}"
        except Exception as e:
            last_error = e
        finally:
            # Close on both success and failure — the previous code only
            # closed in the exception path, leaking file descriptors on every
            # successful call.
            try:
                ssh.close()
            except Exception:
                pass
    return f"[SSH ERROR] {last_error}"
