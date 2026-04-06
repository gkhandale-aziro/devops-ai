"""
Tests for sandbox/redact.py — streaming credential redaction.
"""
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sandbox.redact import StreamRedactor


def _make_sse(tokens):
    """Helper: turn a list of strings into SSE data chunks like the real stream."""
    for t in tokens:
        yield f"data: {json.dumps({'t': t})}\n\n"
    yield "data: [DONE]\n\n"


def _collect(generator):
    """Collect all yielded SSE chunks into a list."""
    return list(generator)


def _extract_text(chunks):
    """Extract the concatenated text from token chunks."""
    text = ""
    for chunk in chunks:
        if not chunk.startswith("data: "):
            continue
        payload = chunk[6:].strip()
        if payload == "[DONE]":
            continue
        try:
            data = json.loads(payload)
            text += data.get("t", "")
        except (json.JSONDecodeError, ValueError):
            pass
    return text


class TestCleanPassthrough:
    """Clean streams must pass through unchanged (content-wise)."""

    def test_simple_text(self):
        r = StreamRedactor()
        chunks = _collect(r.redact_stream(_make_sse(["Hello ", "world!"])))
        text = _extract_text(chunks)
        assert text == "Hello world!"
        assert chunks[-1].strip() == "data: [DONE]"

    def test_empty_stream(self):
        r = StreamRedactor()
        chunks = _collect(r.redact_stream(_make_sse([])))
        assert any("[DONE]" in c for c in chunks)

    def test_normal_code_output(self):
        r = StreamRedactor()
        tokens = ["kubectl ", "get pods ", "-A\n", "NAME  STATUS\n", "nginx  Running"]
        chunks = _collect(r.redact_stream(_make_sse(tokens)))
        text = _extract_text(chunks)
        assert text == "".join(tokens)

    def test_cmd_chunks_pass_through(self):
        r = StreamRedactor()
        def gen():
            yield f"data: {json.dumps({'cmd': 'kubectl get pods'})}\n\n"
            yield "data: [DONE]\n\n"
        chunks = _collect(r.redact_stream(gen()))
        assert any("kubectl get pods" in c for c in chunks)

    def test_non_data_lines_pass_through(self):
        r = StreamRedactor()
        def gen():
            yield ": keepalive\n\n"
            yield f"data: {json.dumps({'t': 'hi'})}\n\n"
            yield "data: [DONE]\n\n"
        chunks = _collect(r.redact_stream(gen()))
        assert chunks[0] == ": keepalive\n\n"


class TestMidChunkSecretDetection:
    """Secrets fully contained in a single chunk must be redacted."""

    def test_aws_access_key(self):
        r = StreamRedactor()
        secret = "AKIAIOSFODNN7EXAMPLE"
        chunks = _collect(r.redact_stream(_make_sse([f"key is {secret} here"])))
        text = _extract_text(chunks)
        assert secret not in text
        assert "[REDACTED]" in text

    def test_jwt_token(self):
        r = StreamRedactor()
        jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
        chunks = _collect(r.redact_stream(_make_sse([f"token: {jwt}"])))
        text = _extract_text(chunks)
        assert jwt not in text
        assert "[REDACTED]" in text

    def test_bearer_token(self):
        r = StreamRedactor()
        bearer = "Bearer sk-proj-abc123def456ghi789jkl012mno345"
        chunks = _collect(r.redact_stream(_make_sse([f"Authorization: {bearer}"])))
        text = _extract_text(chunks)
        assert "sk-proj-abc123def456ghi789jkl012mno345" not in text
        assert "[REDACTED]" in text

    def test_github_token(self):
        r = StreamRedactor()
        ghtoken = "ghp_ABCDEFghijklmnop1234567890abcdefghij"
        chunks = _collect(r.redact_stream(_make_sse([f"GITHUB_TOKEN={ghtoken}"])))
        text = _extract_text(chunks)
        assert ghtoken not in text
        assert "[REDACTED]" in text

    def test_password_key_value(self):
        r = StreamRedactor()
        chunks = _collect(r.redact_stream(
            _make_sse(["config: password=SuperSecret12345678 done"])
        ))
        text = _extract_text(chunks)
        assert "SuperSecret12345678" not in text
        assert "[REDACTED]" in text

    def test_api_key_pattern(self):
        r = StreamRedactor()
        chunks = _collect(r.redact_stream(
            _make_sse(["export API_KEY=sk_live_abcdefghijklmnop"])
        ))
        text = _extract_text(chunks)
        assert "sk_live_abcdefghijklmnop" not in text
        assert "[REDACTED]" in text

    def test_google_api_key(self):
        r = StreamRedactor()
        gkey = "AIzaSyB55quqd9SUITHEdUoFe3lukGshnPnFnnI"
        chunks = _collect(r.redact_stream(_make_sse([f"key={gkey}"])))
        text = _extract_text(chunks)
        assert gkey not in text
        assert "[REDACTED]" in text

    def test_private_key_header(self):
        r = StreamRedactor()
        chunks = _collect(r.redact_stream(
            _make_sse(["-----BEGIN RSA PRIVATE KEY-----\nMIIE..."])
        ))
        text = _extract_text(chunks)
        assert "-----BEGIN RSA PRIVATE KEY-----" not in text
        assert "[REDACTED]" in text

    def test_connection_string(self):
        r = StreamRedactor()
        connstr = "postgres://admin:p4ssw0rd_secret@db.host:5432/mydb"
        chunks = _collect(r.redact_stream(_make_sse([connstr])))
        text = _extract_text(chunks)
        assert "p4ssw0rd_secret" not in text
        assert "[REDACTED]" in text

    def test_cmd_with_secret_is_redacted(self):
        r = StreamRedactor()
        def gen():
            yield f"data: {json.dumps({'cmd': 'curl -H \"Authorization: Bearer sk-proj-abc123def456ghi789jkl012mno345\"'})}\n\n"
            yield "data: [DONE]\n\n"
        chunks = _collect(r.redact_stream(gen()))
        cmd_chunk = chunks[0]
        assert "sk-proj-abc123def456ghi789jkl012mno345" not in cmd_chunk
        assert "[REDACTED]" in cmd_chunk

    def test_error_with_secret_is_redacted(self):
        r = StreamRedactor()
        def gen():
            yield f"data: {json.dumps({'error': 'API key AKIAIOSFODNN7EXAMPLE leaked'})}\n\n"
            yield "data: [DONE]\n\n"
        chunks = _collect(r.redact_stream(gen()))
        assert "AKIAIOSFODNN7EXAMPLE" not in chunks[0]
        assert "[REDACTED]" in chunks[0]


class TestMultiChunkSecretSpanning:
    """Secrets split across two chunks must still be caught."""

    def test_aws_key_split_across_chunks(self):
        r = StreamRedactor()
        # AKIAIOSFODNN7EXAMPLE split across two chunks
        part1 = "here is key AKIAIOSF"
        part2 = "ODNN7EXAMPLE and more text after to exceed buffer window " * 12
        chunks = _collect(r.redact_stream(_make_sse([part1, part2])))
        text = _extract_text(chunks)
        assert "AKIAIOSFODNN7EXAMPLE" not in text
        assert "[REDACTED]" in text

    def test_jwt_split_across_chunks(self):
        r = StreamRedactor()
        jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
        mid = len(jwt) // 2
        part1 = f"token: {jwt[:mid]}"
        part2 = jwt[mid:] + " and trailing text " * 30
        chunks = _collect(r.redact_stream(_make_sse([part1, part2])))
        text = _extract_text(chunks)
        assert jwt not in text
        assert "[REDACTED]" in text

    def test_github_token_split(self):
        r = StreamRedactor()
        token = "ghp_ABCDEFghijklmnop1234567890abcdefghij"
        part1 = f"GITHUB_TOKEN={token[:15]}"
        part2 = token[15:] + " rest of the output " * 30
        chunks = _collect(r.redact_stream(_make_sse([part1, part2])))
        text = _extract_text(chunks)
        assert token not in text
        assert "[REDACTED]" in text

    def test_done_flushes_buffer(self):
        """Remaining buffer must be flushed (and redacted) when [DONE] arrives."""
        r = StreamRedactor()
        # Short text that stays in buffer until DONE
        chunks = _collect(r.redact_stream(_make_sse(["short"])))
        text = _extract_text(chunks)
        assert "short" in text

    def test_multiple_secrets_in_stream(self):
        r = StreamRedactor()
        tokens = [
            "AWS key: AKIAIOSFODNN7EXAMPLE\n",
            "Also token: ghp_ABCDEFghijklmnop1234567890abcdefghij\n",
            "Plus password=MySecretPassword1234 done " * 15,
        ]
        chunks = _collect(r.redact_stream(_make_sse(tokens)))
        text = _extract_text(chunks)
        assert "AKIAIOSFODNN7EXAMPLE" not in text
        assert "ghp_ABCDEFghijklmnop1234567890abcdefghij" not in text
        assert "MySecretPassword1234" not in text
        assert text.count("[REDACTED]") >= 3


class TestFlush:
    """Test the manual flush method."""

    def test_flush_returns_redacted_buffer(self):
        r = StreamRedactor()
        r._buffer = "secret key AKIAIOSFODNN7EXAMPLE"
        result = r.flush()
        assert "AKIAIOSFODNN7EXAMPLE" not in result
        assert "[REDACTED]" in result
        assert r._buffer == ""

    def test_flush_empty_buffer(self):
        r = StreamRedactor()
        assert r.flush() == ""
