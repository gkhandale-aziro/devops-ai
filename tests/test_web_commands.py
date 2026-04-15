"""
tests/test_web_commands.py — regression tests for M-02 (Docker template
quoting) and M-03 (_trim deduplication).
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import re


# ── M-02: Docker connectivity test must quote the Go template ────────────────

class TestDockerTestCommandQuoting:
    """
    `docker info --format {{.ServerVersion}}` without quotes is parsed by
    the shell as brace-expansion. Must use '{{.ServerVersion}}'.
    """

    def test_docker_command_quotes_template(self):
        from ui.web import _TEST_COMMANDS
        cmd = _TEST_COMMANDS["docker"]
        assert "'{{.ServerVersion}}'" in cmd, (
            f"Docker template must be single-quoted to survive shell parsing; got: {cmd}"
        )

    def test_docker_command_has_no_unquoted_template(self):
        from ui.web import _TEST_COMMANDS
        cmd = _TEST_COMMANDS["docker"]
        # There should be no occurrence of {{.ServerVersion}} NOT preceded by a quote
        unquoted = re.search(r"(?<!['\"])\{\{\.ServerVersion\}\}", cmd)
        assert unquoted is None, f"Found unquoted Go template in: {cmd}"

    def test_all_connectivity_commands_present(self):
        from ui.web import _TEST_COMMANDS
        for key in ("kubernetes", "docker", "aws", "gcp", "azure", "terraform"):
            assert key in _TEST_COMMANDS


# ── M-03: _trim lives in one place only (agent.manager) ──────────────────────

class TestTrimDeduplication:
    """web.py used to define its own _trim; now it must import from agent.manager."""

    def test_web_trim_is_agent_manager_trim(self):
        from ui.web import _trim as web_trim
        from agent.manager import _trim as agent_trim
        assert web_trim is agent_trim, (
            "ui.web._trim must be the same object as agent.manager._trim "
            "(imported, not redefined)"
        )

    def test_trim_preserves_system_and_trims_history(self):
        from agent.manager import _trim, MAX_HISTORY
        messages = (
            [{"role": "system", "content": "s"}]
            + [{"role": "user", "content": str(i)} for i in range(MAX_HISTORY + 5)]
        )
        result = _trim(messages)
        assert result[0]["role"] == "system"
        # System msg + last MAX_HISTORY non-system msgs
        assert len(result) == 1 + MAX_HISTORY
        # Oldest non-system messages are dropped
        assert result[1]["content"] == "5"
        assert result[-1]["content"] == str(MAX_HISTORY + 4)

    def test_trim_short_history_unchanged(self):
        from agent.manager import _trim
        messages = [
            {"role": "system", "content": "s"},
            {"role": "user", "content": "hi"},
        ]
        assert _trim(messages) == messages
