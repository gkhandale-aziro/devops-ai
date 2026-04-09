"""
sandbox/docker_sandbox.py — execute commands inside a Docker container for full isolation.
"""
import os
import shlex
from tools.base import run_command

SANDBOX_IMAGE = os.environ.get("SANDBOX_IMAGE", "bitnami/kubectl:latest")


def run_docker_sandbox(command):
    escaped    = shlex.quote(command)
    docker_cmd = f"docker run --rm --network host -v ~/.kube:/root/.kube {SANDBOX_IMAGE} sh -c {escaped}"
    return run_command(docker_cmd)
