"""
tools/gcp.py — execute GCP CLI commands with optional project, region, and service account key.
"""
from .base import run_command


def run_gcp(config, command):
    project     = config.get("project", "")
    region      = config.get("region", "")
    zone        = config.get("zone", "")
    sa_key_file = config.get("service_account_key_file", "")

    env_parts = []
    if sa_key_file:
        env_parts.append(f"GOOGLE_APPLICATION_CREDENTIALS={sa_key_file}")

    if "gcloud" in command:
        if project and "--project" not in command:
            command = command.replace("gcloud ", f"gcloud --project={project} ", 1)
        if region and "--region" not in command and "--zone" not in command:
            command += f" --region {region}"
        elif zone and "--zone" not in command and "--region" not in command:
            command += f" --zone {zone}"

    prefix = " ".join(env_parts) + " " if env_parts else ""
    return run_command(prefix + command)
