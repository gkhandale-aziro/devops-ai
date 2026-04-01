"""
tools/base.py — low-level command runner with timeout and output truncation.
"""
import subprocess

MAX_OUTPUT_CHARS = 3000


def run_command(command, timeout=30):
    """Run a shell command. Returns combined stdout+stderr, truncated."""
    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, text=True, timeout=timeout
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
