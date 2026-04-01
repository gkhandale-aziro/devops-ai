"""
agent/conversation.py — agentic loop: LLM ↔ tool execution ↔ streaming reply.
Mirrors pkg/agent/conversation.go in kubectl-ai.
"""
import re
import json
from providers import chat, chat_stream, TOOL_MODEL, ANSWER_MODEL
from tools     import execute_on_target

MAX_STEPS = 5


def run_agentic_loop(messages, target, session, target_id):
    """
    Generator — yields SSE-formatted strings.
    Runs the tool-calling loop then streams the final answer.
    """
    commands_run = 0
    ran_commands = set()

    for step in range(MAX_STEPS):
        try:
            reply, command, tool_call_id = chat(messages, use_tools=True)
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"
            return

        if command:
            if re.search(r'<[^>]+>', command):
                _append_tool(messages, reply, command, tool_call_id,
                             "[Placeholder in command — replace <...> with real value]")
                continue

            if command in ran_commands:
                _append_tool(messages, reply, command, tool_call_id,
                             "[Already ran. Use output already provided.]")
                continue

            yield f"data: {json.dumps({'cmd': command})}\n\n"
            output       = execute_on_target(target, command)
            commands_run += 1
            ran_commands.add(command)
            _append_tool(messages, reply, command, tool_call_id, output)
            session.set(target_id, session.trim(messages))

        else:
            # Final answer — switch to ANSWER_MODEL if different and commands were run
            if ANSWER_MODEL != TOOL_MODEL and commands_run > 0:
                try:
                    for chunk in chat_stream(messages, use_tools=False):
                        yield f"data: {json.dumps({'t': chunk})}\n\n"
                except Exception:
                    yield f"data: {json.dumps({'t': reply})}\n\n"
            else:
                yield f"data: {json.dumps({'t': reply})}\n\n"

            messages.append({"role": "assistant", "content": reply})
            session.set(target_id, messages)
            yield "data: [DONE]\n\n"
            return

    # MAX_STEPS reached — stream a summary
    try:
        full = ""
        for chunk in chat_stream(messages, use_tools=False):
            full += chunk
            yield f"data: {json.dumps({'t': chunk})}\n\n"
        messages.append({"role": "assistant", "content": full})
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"

    session.set(target_id, messages)
    yield "data: [DONE]\n\n"


def run_direct_stream(messages):
    """Generator — stream a direct (no-tool) AI reply as SSE."""
    try:
        for chunk in chat_stream(messages, use_tools=False):
            yield f"data: {json.dumps({'t': chunk})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
    yield "data: [DONE]\n\n"


# ── internal helper ──────────────────────────────────────────────────────────

def _append_tool(messages, reply, command, tool_call_id, output):
    messages.append({
        "role": "assistant",
        "content": reply or "",
        "tool_calls": [{"id": tool_call_id, "type": "function", "function": {
            "name": "run_command",
            "arguments": json.dumps({"command": command}),
        }}],
    })
    messages.append({"role": "tool", "content": output, "tool_call_id": tool_call_id})
