"""
tools/executor.py — route commands to the correct tool based on target type.
"""
from .ssh       import run_ssh
from .kubectl   import run_kubernetes
from .docker    import run_docker
from .terraform import run_terraform
from .aws       import run_aws
from .gcp       import run_gcp
from .azure     import run_azure
from .local     import run_local

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
