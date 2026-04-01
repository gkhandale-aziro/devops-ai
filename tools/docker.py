"""
tools/docker.py — execute Docker commands against local or remote daemon.
"""
from .base import run_command


def run_docker(config, command):
    docker_host = config.get("host", "")
    prefix      = f"DOCKER_HOST={docker_host} " if docker_host else ""
    return run_command(prefix + command)
