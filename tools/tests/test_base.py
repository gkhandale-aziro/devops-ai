"""
Tests for tools/base.py — run_command with timeout and truncation.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from tools.base import run_command, MAX_OUTPUT_CHARS

# Use the same Python interpreter that's running the tests — works on any system
# Double-quote the path so it works on Windows (spaces in path) and Unix alike
PYTHON = f'"{sys.executable}"'


class TestRunCommand:
    def test_simple_command(self):
        out = run_command("echo hello")
        assert "hello" in out

    def test_stderr_included(self):
        out = run_command("echo error >&2")
        assert "error" in out

    def test_nonexistent_command(self):
        out = run_command("nonexistentcmd123")
        assert out  # returns something (exit code or error message)

    def test_timeout(self):
        out = run_command("sleep 10", timeout=1)
        assert "TIMEOUT" in out

    def test_output_truncated(self):
        # Generate output larger than MAX_OUTPUT_CHARS
        out = run_command(f"{PYTHON} -c \"print('x' * {MAX_OUTPUT_CHARS + 500})\"")
        assert "truncated" in out
        assert len(out) <= MAX_OUTPUT_CHARS + 100  # allow for truncation message

    def test_exit_code_on_empty_output(self):
        out = run_command("exit 1", timeout=5)
        assert out  # returns exit code info
