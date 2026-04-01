"""
tools/aws.py — execute AWS CLI commands with optional profile and region.
"""
from .base import run_command


def run_aws(config, command):
    profile = config.get("profile", "")
    region  = config.get("region", "")
    env     = ""
    if profile:
        env += f"AWS_PROFILE={profile} "
    if region:
        env += f"AWS_DEFAULT_REGION={region} "
    return run_command(env + command)
