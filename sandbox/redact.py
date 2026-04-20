"""
sandbox/redact.py — streaming-aware credential redaction for SSE streams.
Buffers incoming chunks and scans a rolling window for sensitive patterns
before yielding safe content downstream.
"""
import re
import json

# ── Compiled regex patterns for performance ──────────────────────────────────

_PATTERNS = [
    # AWS access keys  (AKIA followed by 16 alphanumeric chars)
    re.compile(r'AKIA[0-9A-Z]{16}', re.ASCII),

    # AWS secret keys  (40 base64-ish chars after common labels)
    re.compile(
        r'(?:aws_secret_access_key|secret_access_key|SecretAccessKey)'
        r'\s*[=:]\s*["\']?([A-Za-z0-9/+=]{40})["\']?',
        re.IGNORECASE,
    ),

    # Generic API keys  (key=... / api_key=... / apikey=...)
    re.compile(
        r'(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|auth[_-]?token'
        r'|token|password|passwd|secret|credential|client[_-]?secret)'
        r'\s*[=:]\s*["\']?([A-Za-z0-9_.+/=-]{16,})["\']?',
        re.IGNORECASE,
    ),

    # JWT tokens  (three base64url parts separated by dots)
    re.compile(r'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'),

    # Bearer tokens in headers
    re.compile(r'Bearer\s+[A-Za-z0-9_.+/=-]{20,}', re.IGNORECASE),

    # Base64-encoded secrets (at least 40 chars of base64 ending with = or ==)
    re.compile(r'(?:^|[\s=:"\'])([A-Za-z0-9+/]{40,}={1,2})(?:[\s"\']|$)'),

    # GitHub / GitLab tokens
    re.compile(r'(?:ghp|gho|ghu|ghs|ghr|glpat)[_-][A-Za-z0-9]{16,}'),

    # Slack tokens
    re.compile(r'xox[bpars]-[A-Za-z0-9-]{10,}'),

    # Generic hex secrets (64-char hex strings — e.g. SHA256 secrets)
    re.compile(r'(?:^|[\s=:"\'])([0-9a-f]{64})(?:[\s"\']|$)', re.IGNORECASE),

    # Private key blocks
    re.compile(r'-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----'),

    # Google API keys
    re.compile(r'AIza[A-Za-z0-9_-]{35}'),

    # Connection strings with passwords
    re.compile(
        r'(?:mongodb|postgres|mysql|redis|amqp)://[^:]+:[^@\s]{8,}@',
        re.IGNORECASE,
    ),
]

_REDACTED = "[REDACTED]"

# Longest pattern we need to match across chunk boundaries.
# Keep buffer at least this long before flushing safe prefix.
_MAX_PATTERN_LEN = 512


def redact_text(text: str) -> str:
    """Apply all compiled secret patterns to a text string.

    Module-level so non-streaming callers (store writes, logs, tests) can
    reuse the same rule set StreamRedactor uses for SSE output. Keeping the
    pattern list in one place means a new detector lands in every redaction
    path at once, not just the one the author remembered to update.
    """
    if not text:
        return text
    for pattern in _PATTERNS:
        text = pattern.sub(_REDACTED, text)
    return text


class StreamRedactor:
    """
    Wraps an SSE generator and redacts sensitive patterns from streamed content.

    Usage:
        redactor = StreamRedactor()
        return Response(redactor.redact_stream(sse_generator()), ...)
    """

    def __init__(self):
        self._buffer = ""

    def _redact_text(self, text):
        """Apply all compiled patterns to a text string."""
        return redact_text(text)

    def redact_stream(self, generator):
        """
        Wraps an SSE generator. Buffers chunks, scans for secrets in a
        rolling window, and yields safe content as soon as possible.
        """
        self._buffer = ""

        for chunk in generator:
            # Pass through non-data lines (SSE comments, empty lines, [DONE])
            if not chunk.startswith("data: "):
                yield chunk
                continue

            payload = chunk[6:].strip()

            # Pass through control messages
            if payload == "[DONE]":
                # Flush remaining buffer
                if self._buffer:
                    yield f"data: {json.dumps({'t': self._redact_text(self._buffer)})}\n\n"
                    self._buffer = ""
                yield chunk
                continue

            # Try to parse JSON payload
            try:
                data = json.loads(payload)
            except (json.JSONDecodeError, ValueError):
                yield chunk
                continue

            # Only redact text token chunks and error messages
            if "t" in data:
                self._buffer += data["t"]
                # Flush safe prefix if buffer exceeds pattern window
                if len(self._buffer) > _MAX_PATTERN_LEN:
                    # Redact the FULL buffer to catch patterns at boundaries
                    redacted = self._redact_text(self._buffer)
                    safe_len = len(redacted) - _MAX_PATTERN_LEN
                    safe_part = redacted[:safe_len]
                    # Keep the redacted tail — re-redacting is a no-op on [REDACTED]
                    self._buffer = redacted[safe_len:]
                    yield f"data: {json.dumps({'t': safe_part})}\n\n"
                continue

            if "cmd" in data:
                data["cmd"] = self._redact_text(data["cmd"])
                yield f"data: {json.dumps(data)}\n\n"
                continue

            if "error" in data:
                data["error"] = self._redact_text(data["error"])
                yield f"data: {json.dumps(data)}\n\n"
                continue

            # Other payloads pass through unchanged
            yield chunk

    def flush(self):
        """Force-flush any remaining buffer content (redacted)."""
        if self._buffer:
            result = self._redact_text(self._buffer)
            self._buffer = ""
            return result
        return ""
