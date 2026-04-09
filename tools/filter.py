"""
tools/filter.py — detect destructive commands before execution.
"""


def is_destructive(command):
    """Return True if command modifies or deletes resources."""
    cmd = f" {command} "
    destructive = [
        " delete ", " remove ", " rm ", " drop ", " truncate ",
        " kill ", " destroy ", " reset ", " purge ",
        "kubectl apply", "kubectl create", "kubectl patch",
        "kubectl edit", "kubectl scale", "kubectl rollout restart",
        "docker stop", "docker rm", "docker rmi", "docker kill",
        "helm install", "helm upgrade", "helm uninstall",
        "git push", "git reset", "git rebase",
    ]
    return any(w in cmd for w in destructive)
