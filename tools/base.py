"""
tools/base.py — low-level command runner with timeout and output truncation.
"""
import os
import subprocess

MAX_OUTPUT_CHARS = 3000


def run_command(command, timeout=30, env_overrides=None):
    """Run a shell command. Returns combined stdout+stderr, truncated.

    env_overrides : optional dict of extra env vars merged onto os.environ.
        Passed to the child via subprocess env= rather than as a shell
        prefix string, so values cannot be reinterpreted by the shell —
        defense in depth on top of the shlex.quote() call sites.
    """
    env = None
    if env_overrides:
        env = {**os.environ, **{k: str(v) for k, v in env_overrides.items()}}
    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, text=True,
            timeout=timeout, env=env,
        )
        output = result.stdout
        if result.stderr:
            output = output + result.stderr if output else result.stderr
        if not output:
            output = f"[Exit code: {result.returncode}]"
    except subprocess.TimeoutExpired:
        output = f"[TIMEOUT] Command took longer than {timeout}s: {command}"

    if len(output) > MAX_OUTPUT_CHARS:
        output = output[:MAX_OUTPUT_CHARS] + f"\n... [truncated — showing first {MAX_OUTPUT_CHARS} chars]"

    return output
