"""
Tests for providers/client.py — multi-provider AI client.
Uses mocks so no real AI calls are made.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import json
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
from providers.client import LLMClient


def _make_response(content=None, tool_call_cmd=None):
    """Build a mock OpenAI-format completion response."""
    if tool_call_cmd:
        tool_call = SimpleNamespace(
            id="tc-123",
            function=SimpleNamespace(
                arguments=json.dumps({"command": tool_call_cmd}),
            ),
        )
        message = SimpleNamespace(content="", tool_calls=[tool_call])
    else:
        message = SimpleNamespace(
            content=content or "Here is my answer.",
            tool_calls=None,
        )

    return SimpleNamespace(
        choices=[SimpleNamespace(message=message)],
        usage=SimpleNamespace(total_tokens=42),
    )


class TestChat:
    def setup_method(self):
        self.client = LLMClient()

    def test_direct_answer(self):
        with patch("providers.client._call_api", return_value=_make_response("All pods running.")):
            reply, command, tool_call_id = self.client.chat(
                [{"role": "user", "content": "status?"}], use_tools=False
            )
        assert reply == "All pods running."
        assert command is None
        assert tool_call_id is None

    def test_tool_call_returned(self):
        with patch("providers.client._call_api", return_value=_make_response(tool_call_cmd="kubectl get pods -A")):
            reply, command, tool_call_id = self.client.chat(
                [{"role": "user", "content": "show pods"}], use_tools=True
            )
        assert command == "kubectl get pods -A"
        assert tool_call_id == "tc-123"


class TestChatStream:
    def setup_method(self):
        self.client = LLMClient()

    def _make_chunks(self, words):
        chunks = []
        for w in words:
            delta = SimpleNamespace(content=w)
            chunks.append(SimpleNamespace(choices=[SimpleNamespace(delta=delta)]))
        return chunks

    def test_yields_tokens(self):
        chunks = self._make_chunks(["Hello", " world", "!"])
        with patch("providers.client._call_api", return_value=iter(chunks)):
            result = list(self.client.chat_stream(
                [{"role": "user", "content": "hi"}]
            ))
        assert result == ["Hello", " world", "!"]

    def test_skips_empty_delta(self):
        chunk_none = SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=None))])
        chunk_text = SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="hi"))])
        with patch("providers.client._call_api", return_value=iter([chunk_none, chunk_text])):
            result = list(self.client.chat_stream(
                [{"role": "user", "content": "test"}]
            ))
        assert result == ["hi"]
