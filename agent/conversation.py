"""
agent/conversation.py — agentic loop: LLM ↔ tool execution ↔ streaming reply.
Mirrors pkg/agent/conversation.go in kubectl-ai.

Two modes:
  run_loop()  — CLI: blocking thread, in/out queues (like Agent.Run() goroutine)
  run()       — Web: SSE generator per request
  stream()    — Web: direct streaming SSE, no tool calls
"""
import re
import json
import time
import queue as _queue
from tools.filter      import is_destructive
from agent.needs_tools import needs_tools

MAX_STEPS = 5


class Agent:
    """
    Runs the tool-calling agentic loop.
    Mirrors kubectl-ai's Agent struct in pkg/agent/conversation.go.

    CLI:  agent.run_loop(in_q, out_q, confirm_q, session, target_id, ...)
    Web:  yield from agent.run(messages, target, session, target_id)
          yield from agent.stream(messages)
    """

    def __init__(self, llm, tools):
        self._llm   = llm
        self._tools = tools

    # ── CLI mode — persistent loop ───────────────────────────────────────────

    def run_loop(self, in_q, out_q, confirm_q, session, target_id,
                 target=None, executor_fn=None, store=None):
        """
        Blocking loop for CLI. Runs in a background thread.
        Mirrors Agent.Run() goroutine in pkg/agent/conversation.go:385.

        store : EventStore | None
            If provided, AI analyses are saved for auto-monitor queries.

        Special CLI commands handled before reaching the AI:
            history            — last 10 incidents from DB
            history <name>     — incidents for a specific pod/node
            status             — cluster event stats from DB
        """
        while True:
            # Peek: only show >>> when queue is genuinely empty
            try:
                msg = in_q.get_nowait()
            except _queue.Empty:
                out_q.put({"type": "ready"})
                msg = in_q.get()

            if msg is None:
                break
            if msg.get("type") != "query":
                continue

            is_auto  = msg.get("is_auto", False)
            event_id = msg.get("event_id")
            query    = msg.get("text", "").strip()
            if not query:
                continue

            # ── built-in CLI commands (history / status) ──────────────────
            if not is_auto:
                handled = self._handle_builtin(query, out_q, store)
                if handled:
                    continue

            # announce auto-monitor queries
            if is_auto:
                out_q.put({"type": "auto_start",
                           "label": query.split("\n")[0][:80]})

            messages = session.get(target_id)
            messages.append({"role": "user", "content": query})
            messages = session.trim(messages)
            session.set(target_id, messages)

            # skip agentic loop for simple questions
            if not is_auto and not needs_tools(query):
                full = ""
                try:
                    for chunk in self._llm.chat_stream(messages, use_tools=False):
                        full += chunk
                        out_q.put({"type": "text", "text": chunk})
                except Exception as e:
                    out_q.put({"type": "error", "msg": str(e)})
                messages.append({"role": "assistant", "content": full})
                session.set(target_id, messages)
                out_q.put({"type": "done"})
                continue

            # full agentic loop — collect text to save as analysis
            full_text = ""
            for event in self._run_internal(
                messages, target, session, target_id,
                confirm_q=confirm_q, executor_fn=executor_fn
            ):
                out_q.put(event)
                if event["type"] == "text":
                    full_text += event["text"]

            # save AI analysis to DB for auto-monitor queries
            if is_auto and event_id and store and full_text.strip():
                store.save_analysis(event_id, diagnosis=full_text)

    # ── built-in CLI commands ─────────────────────────────────────────────────

    def _handle_builtin(self, query, out_q, store):
        """
        Handle history / status commands locally without calling the AI.
        Returns True if handled, False if should be passed to AI.
        """
        q = query.lower().strip()

        if q.startswith("history"):
            parts = query.split(None, 1)
            obj   = parts[1].strip() if len(parts) > 1 else None
            if store:
                events = (store.get_object_history(obj)
                          if obj else store.get_events(limit=15))
                out_q.put({"type": "text",
                           "text": _format_history(events, obj)})
            else:
                out_q.put({"type": "text",
                           "text": "No database configured (run with --monitor)."})
            out_q.put({"type": "done"})
            return True

        if q == "status":
            if store:
                out_q.put({"type": "text",
                           "text": _format_stats(store.get_stats())})
            else:
                out_q.put({"type": "text",
                           "text": "No database configured (run with --monitor)."})
            out_q.put({"type": "done"})
            return True

        return False

    # ── Web mode — SSE generators ─────────────────────────────────────────────

    def run(self, messages, target, session, target_id):
        """SSE generator for web streaming. Auto-proceeds on destructive commands."""
        # Send thinking event immediately so frontend knows we're alive
        yield f"data: {json.dumps({'status': 'thinking'})}\n\n"
        _current_cmd = None
        _cmd_start = None

        for event in self._run_internal(messages, target, session, target_id):
            t = event["type"]
            if t == "cmd":
                # Backward compat: old cmd event
                yield f"data: {json.dumps({'cmd': event['cmd']})}\n\n"
                # New: tool_start event for expandable tool-call blocks
                yield f"data: {json.dumps({'tool_start': {'cmd': event['cmd']}})}\n\n"
                _current_cmd = event["cmd"]
                _cmd_start = time.time()
            elif t == "tool_output":
                duration_ms = int((time.time() - _cmd_start) * 1000) if _cmd_start else 0
                output = event.get("output", "")
                truncated = output[:500] if output else ""
                status = "error" if "error" in output.lower()[:100] else "done"
                yield f"data: {json.dumps({'tool_end': {'cmd': _current_cmd, 'output': truncated, 'duration_ms': duration_ms, 'status': status}})}\n\n"
                _current_cmd = None
                _cmd_start = None
            elif t == "text":
                yield f"data: {json.dumps({'t': event['text']})}\n\n"
            elif t == "error":
                yield f"data: {json.dumps({'error': event['msg']})}\n\n"
                yield "data: [DONE]\n\n"
                return
            elif t == "done":
                yield "data: [DONE]\n\n"
                return

    def stream(self, messages):
        """SSE generator — direct streaming, no tool calls."""
        # Send thinking event immediately so frontend knows we're alive
        yield f"data: {json.dumps({'status': 'thinking'})}\n\n"
        try:
            for chunk in self._llm.chat_stream(messages, use_tools=False):
                yield f"data: {json.dumps({'t': chunk})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    # ── Core agentic loop ─────────────────────────────────────────────────────

    def _run_internal(self, messages, target, session, target_id,
                      confirm_q=None, executor_fn=None):
        """
        Core loop. Yields event dicts consumed by run_loop() or run().

        confirm_q   : Queue | None  — destructive commands pause for y/n (CLI only)
        executor_fn : callable | None — override ToolExecutor (CLI sandbox use)
        """
        commands_run = 0
        ran_commands = set()

        for _ in range(MAX_STEPS):
            try:
                reply, command, tool_call_id = self._llm.chat(messages, use_tools=True)
            except Exception as e:
                yield {"type": "error", "msg": str(e)}
                return

            if command:
                if re.search(r'<[^>]+>', command):
                    self._append_tool(messages, reply, command, tool_call_id,
                                      "[Placeholder — replace <...> with real value]")
                    continue

                if command in ran_commands:
                    self._append_tool(messages, reply, command, tool_call_id,
                                      "[Already ran. Use output already provided.]")
                    continue

                if is_destructive(command) and confirm_q is not None:
                    yield {"type": "confirm", "cmd": command}
                    if not confirm_q.get():
                        self._append_tool(messages, reply, command, tool_call_id,
                                          "[User declined]")
                        continue

                yield {"type": "cmd", "cmd": command}
                output = (executor_fn(command) if executor_fn
                          else self._tools.execute(target, command))
                yield {"type": "tool_output", "output": output}
                commands_run += 1
                ran_commands.add(command)
                self._append_tool(messages, reply, command, tool_call_id, output)
                session.set(target_id, session.trim(messages))

            else:
                if self._llm.answer_model != self._llm.tool_model and commands_run > 0:
                    try:
                        for chunk in self._llm.chat_stream(messages, use_tools=False):
                            yield {"type": "text", "text": chunk}
                        reply = ""
                    except Exception:
                        pass

                if reply:
                    yield {"type": "text", "text": reply}

                messages.append({"role": "assistant", "content": reply})
                session.set(target_id, messages)
                yield {"type": "done"}
                return

        # MAX_STEPS reached
        try:
            full = ""
            for chunk in self._llm.chat_stream(messages, use_tools=False):
                full += chunk
                yield {"type": "text", "text": chunk}
            messages.append({"role": "assistant", "content": full})
        except Exception as e:
            yield {"type": "error", "msg": str(e)}

        session.set(target_id, messages)
        yield {"type": "done"}

    # ── helpers ───────────────────────────────────────────────────────────────

    def _append_tool(self, messages, reply, command, tool_call_id, output):
        messages.append({
            "role": "assistant",
            "content": reply or "",
            "tool_calls": [{"id": tool_call_id, "type": "function", "function": {
                "name": "run_command",
                "arguments": json.dumps({"command": command}),
            }}],
        })
        messages.append({"role": "tool", "content": output,
                         "tool_call_id": tool_call_id})


# ── CLI formatters ────────────────────────────────────────────────────────────

def _format_history(events, obj=None):
    if not events:
        return f"No incidents recorded{' for ' + obj if obj else ''}.\n"
    header = f"Incident history{' — ' + obj if obj else ''} (last {len(events)})\n"
    lines  = [header, "─" * 60]
    for e in events:
        ts      = e["timestamp"][:16]
        diag    = (e.get("last_diagnosis") or "")[:80]
        diag_s  = f"\n   └─ {diag}" if diag else ""
        lines.append(f"[{e['level']}] {ts}  {e['reason']} on {e['object']}{diag_s}")
    return "\n".join(lines) + "\n"


def _format_stats(stats):
    counts  = stats.get("counts", {})
    failing = stats.get("top_failing", [])
    recent  = stats.get("recent", [])

    lines = ["Cluster incident stats\n" + "─" * 40]
    lines.append(f"  SEV3 (info):   {counts.get('L1', 0)}")
    lines.append(f"  SEV2 (warning): {counts.get('L2', 0)}")
    lines.append(f"  SEV1 (critical): {counts.get('L3', 0)}")

    if failing:
        lines.append("\nTop failing objects:")
        for f in failing[:5]:
            lines.append(f"  {f['object']:30s}  {f['count']} incidents  "
                         f"(last: {f['last_seen'][:16]})")

    if recent:
        lines.append("\nMost recent events:")
        for e in recent:
            lines.append(f"  [{e['level']}] {e['timestamp'][:16]}  "
                         f"{e['reason']} on {e['object']}")

    return "\n".join(lines) + "\n"
