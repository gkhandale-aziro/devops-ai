"""
Tests for SEC-5 — SSH host-key verification in tools/ssh.py.

Covers:
  - Pinned host_key in config → strict RejectPolicy, HostKeys populated
  - No host_key in config   → backwards-compatible AutoAddPolicy path
  - Malformed host_key      → clean error, no crash
  - BadHostKeyException     → surfaced as error (no retry)
  - fingerprint() helper    → OpenSSH-style SHA256 output
  - capture_host_key()      → transport probe returns "<keytype> <base64>"

These are pure unit tests — paramiko.SSHClient / Transport are mocked so
tests run without a real SSH server. Key objects are generated in-memory
with paramiko.RSAKey.generate() so the HostKeyEntry parse path is real.
"""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

import paramiko  # noqa: E402 — sys.path above

from tools.ssh import (  # noqa: E402
    _install_pinned_host_key,
    capture_host_key,
    fingerprint,
    run_ssh,
)


# ── shared fixtures ──────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def rsa_key():
    """A real RSA host key generated once per module. Used to construct
    valid "<keytype> <base64>" lines that HostKeyEntry.from_line accepts."""
    return paramiko.RSAKey.generate(2048)


@pytest.fixture
def host_key_line(rsa_key):
    return f"{rsa_key.get_name()} {rsa_key.get_base64()}"


# ── _install_pinned_host_key ─────────────────────────────────────────────────

class TestInstallPinnedHostKey:
    def test_valid_key_switches_to_reject_policy(self, host_key_line):
        ssh = paramiko.SSHClient()
        ok = _install_pinned_host_key(ssh, "example.com", host_key_line)
        assert ok is True
        # HostKeys dict must now hold exactly the pinned key
        assert ssh.get_host_keys().lookup("example.com") is not None

    def test_malformed_line_returns_false(self):
        ssh = paramiko.SSHClient()
        assert _install_pinned_host_key(ssh, "h", "not a valid key line") is False

    def test_empty_line_returns_false(self):
        ssh = paramiko.SSHClient()
        assert _install_pinned_host_key(ssh, "h", "") is False


# ── fingerprint() ────────────────────────────────────────────────────────────

class TestFingerprint:
    def test_valid_key_returns_sha256_prefix(self, host_key_line):
        fp = fingerprint(host_key_line)
        assert fp is not None
        assert fp.startswith("SHA256:")
        # SHA256 base64 without padding — always 43 chars after the prefix
        assert len(fp) == len("SHA256:") + 43

    def test_malformed_returns_none(self):
        assert fingerprint("garbage") is None
        assert fingerprint("") is None
        assert fingerprint("ssh-rsa not-valid-base64!!!") is None

    def test_fingerprint_is_stable(self, host_key_line):
        """Same key line → same fingerprint. Guards against accidental use
        of random salt / timestamps in the hash path."""
        assert fingerprint(host_key_line) == fingerprint(host_key_line)


# ── run_ssh strict mode ──────────────────────────────────────────────────────

class TestRunSshStrictMode:
    def test_pinned_key_uses_reject_policy(self, host_key_line):
        """When host_key is set, the client must switch to RejectPolicy so
        an unknown key aborts the connection instead of being auto-added."""
        captured_policy = {}

        class FakeSSH:
            def __init__(self):
                self._policy = None
                self._host_keys = paramiko.HostKeys()

            def get_host_keys(self):
                return self._host_keys

            def set_missing_host_key_policy(self, p):
                self._policy = p
                captured_policy["policy"] = p

            def connect(self, **kwargs):
                pass

            def exec_command(self, cmd, timeout=30):
                stdout = MagicMock()
                stdout.read.return_value = b"hello\n"
                stderr = MagicMock()
                stderr.read.return_value = b""
                return (None, stdout, stderr)

            def close(self):
                pass

        with patch("paramiko.SSHClient", FakeSSH):
            result = run_ssh(
                {"host": "1.2.3.4", "user": "x", "password": "y",
                 "host_key": host_key_line},
                "echo hello",
            )
        assert "hello" in result
        assert isinstance(captured_policy["policy"], paramiko.RejectPolicy)

    def test_malformed_host_key_returns_clean_error(self):
        result = run_ssh(
            {"host": "1.2.3.4", "user": "x", "password": "y",
             "host_key": "this is not a key"},
            "echo hello",
        )
        assert result.startswith("[SSH ERROR]")
        assert "malformed host_key" in result

    def test_bad_host_key_exception_is_surfaced(self, host_key_line):
        """Paramiko raises BadHostKeyException when the server key doesn't
        match the pinned one. Our code must NOT retry (that's an attack
        signal) and must surface a clear error."""
        call_count = {"n": 0}

        class FakeSSH:
            def __init__(self):
                self._host_keys = paramiko.HostKeys()

            def get_host_keys(self):
                return self._host_keys

            def set_missing_host_key_policy(self, p):
                pass

            def connect(self, **kwargs):
                call_count["n"] += 1
                raise paramiko.BadHostKeyException(
                    kwargs["hostname"],
                    paramiko.RSAKey.generate(2048),
                    paramiko.RSAKey.generate(2048),
                )

            def exec_command(self, *a, **kw):
                raise AssertionError("should not reach exec on bad host key")

            def close(self):
                pass

        with patch("paramiko.SSHClient", FakeSSH):
            result = run_ssh(
                {"host": "1.2.3.4", "user": "x", "password": "y",
                 "host_key": host_key_line},
                "echo hi",
            )
        assert result.startswith("[SSH ERROR] host key verification failed")
        assert call_count["n"] == 1, "must not retry on host-key mismatch"


# ── run_ssh backwards-compatible path ────────────────────────────────────────

class TestRunSshCompatMode:
    def test_no_host_key_uses_auto_add(self, caplog):
        """Absence of host_key must keep AutoAddPolicy so existing targets
        keep working — but a warning must be logged so operators can see
        which hosts are unverified."""
        captured_policy = {}

        class FakeSSH:
            def set_missing_host_key_policy(self, p):
                captured_policy["policy"] = p

            def connect(self, **kwargs):
                pass

            def exec_command(self, cmd, timeout=30):
                stdout = MagicMock()
                stdout.read.return_value = b"ok"
                stderr = MagicMock()
                stderr.read.return_value = b""
                return (None, stdout, stderr)

            def close(self):
                pass

        with caplog.at_level("WARNING"):
            with patch("paramiko.SSHClient", FakeSSH):
                result = run_ssh(
                    {"host": "1.2.3.4", "user": "x", "password": "y"},
                    "uptime",
                )
        assert result == "ok"
        assert isinstance(captured_policy["policy"], paramiko.AutoAddPolicy)
        assert any("host_key_unverified" in r.message for r in caplog.records)


# ── capture_host_key() ───────────────────────────────────────────────────────

class TestCaptureHostKey:
    def test_returns_keytype_and_base64(self, rsa_key):
        class FakeTransport:
            def __init__(self, addr):
                self.addr = addr

            def start_client(self, timeout=10):
                pass

            def get_remote_server_key(self):
                return rsa_key

            def close(self):
                pass

        with patch("paramiko.Transport", FakeTransport):
            result = capture_host_key({"host": "1.2.3.4", "port": 22})
        assert result == f"{rsa_key.get_name()} {rsa_key.get_base64()}"

    def test_missing_host_returns_error(self):
        result = capture_host_key({})
        assert result.startswith("[ERROR]")

    def test_connection_failure_returns_error(self):
        class FakeTransport:
            def __init__(self, addr):
                raise OSError("connection refused")

            def close(self):
                pass

        with patch("paramiko.Transport", FakeTransport):
            result = capture_host_key({"host": "1.2.3.4", "port": 22})
        assert result.startswith("[SSH ERROR]")
        assert "connection refused" in result
