"""
Tests for providers/client.py — OpenAI SDK wrapper.
Uses mocks so no real AI calls are made.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import json
from unittest.mock import patch, MagicMock
from providers.client import LLMClient


def _make_response(content=None, tool_call_cmd=None):
    """Build a mock OpenAI completion response."""
    choice  = MagicMock()
    usage   = MagicMock()
    usage.total_tokens = 42

    if tool_call_cmd:
        tool_call             = MagicMock()
        tool_call.id          = "tc-123"
        tool_call.function.arguments = json.dumps({"command": tool_call_cmd})
        choice.message.tool_calls    = [tool_call]
        choice.message.content       = ""
    else:
        choice.message.tool_calls = None
        choice.message.content    = content or "Here is my answer."

    response         = MagicMock()
    response.choices = [choice]
    response.usage   = usage
    return response


def _mock_make_client(model):
    """Return a mock OpenAI client + stripped model name."""
    client = MagicMock()
    model_name = model.split("/", 1)[1] if "/" in model else model
    return client, model_name


class TestChat:
    def setup_method(self):
        self.client = LLMClient()

    def test_direct_answer(self):
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _make_response("All pods running.")
        with patch("providers.client._make_client", return_value=(mock_client, "qwen2.5:7b")):
            reply, command, tool_call_id = self.client.chat(
                [{"role": "user", "content": "status?"}], use_tools=False
            )
        assert reply == "All pods running."
        assert command is None
        assert tool_call_id is None

    def test_tool_call_returned(self):
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _make_response(
            tool_call_cmd="kubectl get pods -A"
        )
        with patch("providers.client._make_client", return_value=(mock_client, "qwen2.5:7b")):
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
            chunk = MagicMock()
            chunk.choices[0].delta.content = w
            chunks.append(chunk)
        return chunks

    def test_yields_tokens(self):
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = self._make_chunks(
            ["Hello", " world", "!"]
        )
        with patch("providers.client._make_client", return_value=(mock_client, "qwen2.5:7b")):
            result = list(self.client.chat_stream(
                [{"role": "user", "content": "hi"}]
            ))
        assert result == ["Hello", " world", "!"]

    def test_skips_empty_delta(self):
        chunk_with_none = MagicMock()
        chunk_with_none.choices[0].delta.content = None
        chunk_with_text = MagicMock()
        chunk_with_text.choices[0].delta.content = "hi"
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = [chunk_with_none, chunk_with_text]
        with patch("providers.client._make_client", return_value=(mock_client, "qwen2.5:7b")):
            result = list(self.client.chat_stream(
                [{"role": "user", "content": "test"}]
            ))
        assert result == ["hi"]
