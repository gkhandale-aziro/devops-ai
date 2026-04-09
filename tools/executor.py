"""
tools/executor.py — route commands to the correct tool based on target type.
Mirrors kubectl-ai's tool registry pattern.
"""
from .ssh       import run_ssh
from .kubectl   import run_kubernetes
from .docker    import run_docker
from .terraform import run_terraform
from .aws       import run_aws
from .gcp       import run_gcp
from .azure     import run_azure
from .local     import run_local


class ToolExecutor:
    """
    Routes a command to the right executor based on target type.
    Mirrors how kubectl-ai registers bash/kubectl tools in Agent.Init().
    """

    def __init__(self):
        self._executors = {
            "ssh":        run_ssh,
            "local":      run_local,
            "kubernetes": run_kubernetes,
            "docker":     run_docker,
            "terraform":  run_terraform,
            "aws":        run_aws,
            "gcp":        run_gcp,
            "azure":      run_azure,
        }

    def execute(self, target, command):
        """Run command on target. Returns output string."""
        executor = self._executors.get(target.get("type", "ssh"))
        if not executor:
            return f"[ERROR] Unknown target type: {target.get('type')}"
        return executor(target.get("config", {}), command)
