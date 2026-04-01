"""
tools/local.py — execute commands directly on this machine (no SSH).
"""
from .base import run_command


def run_local(config, command):
    return run_command(command)
