"""
tools/docker.py — execute Docker commands against local or remote daemon.
Supports TLS for secure remote connections (DOCKER_TLS_VERIFY, DOCKER_CERT_PATH).
"""
from .base import run_command


def run_docker(config, command):
    docker_host = config.get("host", "")
    tls_verify  = config.get("tls_verify", "")
    cert_path   = config.get("cert_path", "")
    api_version = config.get("api_version", "")

    env_parts = []
    if docker_host:
        env_parts.append(f"DOCKER_HOST={docker_host}")
    if tls_verify:
        env_parts.append("DOCKER_TLS_VERIFY=1")
    if cert_path:
        env_parts.append(f"DOCKER_CERT_PATH={cert_path}")
    if api_version:
        env_parts.append(f"DOCKER_API_VERSION={api_version}")

    prefix = " ".join(env_parts) + " " if env_parts else ""
    return run_command(prefix + command)
