"""
tools/aws.py — execute AWS CLI commands with optional profile, region, or access keys.
Supports named profiles, explicit access keys, and temporary session tokens.
"""
from .base import run_command


def run_aws(config, command):
    profile        = config.get("profile", "")
    region         = config.get("region", "")
    access_key     = config.get("access_key_id", "")
    secret_key     = config.get("secret_access_key", "")
    session_token  = config.get("session_token", "")
    endpoint_url   = config.get("endpoint_url", "")

    env_parts = []
    if profile:
        env_parts.append(f"AWS_PROFILE={profile}")
    if region:
        env_parts.append(f"AWS_DEFAULT_REGION={region}")
    # Explicit keys override profile
    if access_key:
        env_parts.append(f"AWS_ACCESS_KEY_ID={access_key}")
    if secret_key:
        env_parts.append(f"AWS_SECRET_ACCESS_KEY={secret_key}")
    if session_token:
        env_parts.append(f"AWS_SESSION_TOKEN={session_token}")

    # Inject --endpoint-url for LocalStack / custom endpoints
    if endpoint_url and "aws " in command and "--endpoint-url" not in command:
        command = command.replace("aws ", f"aws --endpoint-url {endpoint_url} ", 1)

    prefix = " ".join(env_parts) + " " if env_parts else ""
    return run_command(prefix + command)
