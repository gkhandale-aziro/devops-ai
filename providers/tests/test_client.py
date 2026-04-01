"""
Tests for providers/client.py — LiteLLM wrapper.
Uses mocks so no real AI calls are made.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import json
from unittest.mock import patch, MagicMock


def _make_response(content=None, tool_call_cmd=None):
    """Build a mock litellm completion response."""
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


class TestChat:
    def test_direct_answer(self):
        from providers.client import chat
        with patch("providers.client.litellm.completion", return_value=_make_response("All pods running.")):
            reply, command, tool_call_id = chat([{"role": "user", "content": "status?"}], use_tools=False)
        assert reply == "All pods running."
        assert command is None
        assert tool_call_id is None

    def test_tool_call_returned(self):
        from providers.client import chat
        with patch("providers.client.litellm.completion", return_value=_make_response(tool_call_cmd="kubectl get pods -A")):
            reply, command, tool_call_id = chat([{"role": "user", "content": "show pods"}], use_tools=True)
        assert command == "kubectl get pods -A"
        assert tool_call_id == "tc-123"

    def test_use_tools_false_uses_answer_model(self):
        from providers import client as c
        original = c.ANSWER_MODEL
        c.ANSWER_MODEL = "ollama/answer-model"
        called_with = {}

        def mock_completion(**kwargs):
            called_with["model"] = kwargs["model"]
            return _make_response("answer")

        with patch("providers.client.litellm.completion", side_effect=mock_completion):
            c.chat([{"role": "user", "content": "hi"}], use_tools=False)

        assert called_with["model"] == "ollama/answer-model"
        c.ANSWER_MODEL = original

    def test_use_tools_true_uses_tool_model(self):
        from providers import client as c
        original = c.TOOL_MODEL
        c.TOOL_MODEL = "ollama/tool-model"
        called_with = {}

        def mock_completion(**kwargs):
            called_with["model"] = kwargs["model"]
            return _make_response("answer")

        with patch("providers.client.litellm.completion", side_effect=mock_completion):
            c.chat([{"role": "user", "content": "hi"}], use_tools=True)

        assert called_with["model"] == "ollama/tool-model"
        c.TOOL_MODEL = original


class TestChatStream:
    def _make_chunks(self, words):
        chunks = []
        for w in words:
            chunk = MagicMock()
            chunk.choices[0].delta.content = w
            chunks.append(chunk)
        return chunks

    def test_yields_tokens(self):
        from providers.client import chat_stream
        chunks = self._make_chunks(["Hello", " world", "!"])
        with patch("providers.client.litellm.completion", return_value=chunks):
            result = list(chat_stream([{"role": "user", "content": "hi"}]))
        assert result == ["Hello", " world", "!"]

    def test_skips_empty_delta(self):
        from providers.client import chat_stream
        chunk_with_none = MagicMock()
        chunk_with_none.choices[0].delta.content = None
        chunk_with_text = MagicMock()
        chunk_with_text.choices[0].delta.content = "hi"
        with patch("providers.client.litellm.completion", return_value=[chunk_with_none, chunk_with_text]):
            result = list(chat_stream([{"role": "user", "content": "test"}]))
        assert result == ["hi"]
