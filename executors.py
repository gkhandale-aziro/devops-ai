"""
executors.py — command execution per target type.
SSH uses paramiko (supports both password and key auth).
"""
import subprocess

MAX_OUTPUT = 3000


def _truncate(text):
    if len(text) > MAX_OUTPUT:
        return text[:MAX_OUTPUT] + "\n... [truncated]"
    return text


def _local(cmd, timeout=30, cwd=None):
    """Run command locally."""
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, cwd=cwd)
        out = r.stdout
        if r.stderr:
            out = out + r.stderr if out else r.stderr
        return _truncate(out or f"[Exit {r.returncode}]")
    except subprocess.TimeoutExpired:
        return f"[TIMEOUT after {timeout}s]"


def run_ssh(config, command):
    """SSH into a remote server and run a command. Supports password and key auth."""
    try:
        import paramiko
    except ImportError:
        return "[ERROR] paramiko not installed. Run: pip3 install paramiko"

    host     = config.get("host", "")
    user     = config.get("user", "root")
    port     = int(config.get("port", 22))
    password = config.get("password", "")
    key_path = config.get("key_path", "")

    if not host:
        return "[ERROR] No host configured"

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        connect_kwargs = dict(hostname=host, port=port, username=user, timeout=10)
        if password:
            connect_kwargs["password"] = password
            connect_kwargs["look_for_keys"] = False
        elif key_path:
            connect_kwargs["key_filename"] = key_path
        else:
            connect_kwargs["look_for_keys"] = True  # use default ~/.ssh/id_rsa

        ssh.connect(**connect_kwargs)
        _, stdout, stderr = ssh.exec_command(command, timeout=30)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        output = out + err if out else err
        return _truncate(output or "[No output]")
    except Exception as e:
        return f"[SSH ERROR] {e}"
    finally:
        ssh.close()


def run_kubernetes(config, command):
    """Run kubectl with a specific context."""
    context    = config.get("context", "")
    kubeconfig = config.get("kubeconfig", "")
    prefix = f"KUBECONFIG={kubeconfig} " if kubeconfig else ""
    if context and "kubectl" in command and "--context" not in command:
        command = command.replace("kubectl ", f"kubectl --context={context} ", 1)
    return _local(prefix + command)


def run_docker(config, command):
    """Run docker against local or remote daemon."""
    docker_host = config.get("host", "")
    prefix = f"DOCKER_HOST={docker_host} " if docker_host else ""
    return _local(prefix + command)


def run_terraform(config, command):
    workspace = config.get("workspace", ".")
    return _local(command, timeout=60, cwd=workspace)


def run_aws(config, command):
    profile = config.get("profile", "")
    region  = config.get("region", "")
    env = ""
    if profile: env += f"AWS_PROFILE={profile} "
    if region:  env += f"AWS_DEFAULT_REGION={region} "
    return _local(env + command)


def run_gcp(config, command):
    project = config.get("project", "")
    if project and "gcloud" in command and "--project" not in command:
        command = command.replace("gcloud ", f"gcloud --project={project} ", 1)
    return _local(command)


def run_azure(config, command):
    subscription = config.get("subscription", "")
    if subscription and "az " in command and "--subscription" not in command:
        command += f" --subscription {subscription}"
    return _local(command)


def run_local(config, command):
    """Run command directly on this machine (no SSH)."""
    return _local(command)


EXECUTORS = {
    "ssh":        run_ssh,
    "local":      run_local,
    "kubernetes": run_kubernetes,
    "docker":     run_docker,
    "terraform":  run_terraform,
    "aws":        run_aws,
    "gcp":        run_gcp,
    "azure":      run_azure,
}


def execute_on_target(target, command):
    executor = EXECUTORS.get(target.get("type", "ssh"))
    if not executor:
        return f"[ERROR] Unknown target type: {target.get('type')}"
    return executor(target.get("config", {}), command)
