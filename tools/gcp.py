"""
tools/gcp.py — execute GCP CLI commands with optional project.
"""
from .base import run_command


def run_gcp(config, command):
    project = config.get("project", "")
    if project and "gcloud" in command and "--project" not in command:
        command = command.replace("gcloud ", f"gcloud --project={project} ", 1)
    return run_command(command)
