"""
agent/conversation.py — agentic loop: LLM ↔ tool execution ↔ streaming reply.
Mirrors pkg/agent/conversation.go in kubectl-ai.

Two modes:
  run_loop()  — CLI: blocking thread, in/out queues (like Agent.Run() goroutine)
  run()       — Web: SSE generator per request
  stream()    — Web: direct streaming SSE, no tool calls
"""
import os
import re
import json
import time
import queue as _queue
from tools.filter      import is_destructive
from agent.needs_tools import needs_tools
from observability    import record_tool_call

MAX_STEPS = 5


def _run_token_cap() -> int:
    """OPS-4: max tokens a single agent run may consume before we abort.

    MAX_STEPS alone isn't enough — a pathological loop that keeps appending
    enormous tool outputs can blow through a user's daily budget inside one
    request. The cap catches that case without waiting for the daily counter
    to tick over. 0 disables the check.
    """
    try:
        v = int(os.environ.get("AZIRO_AGENT_RUN_TOKEN_CAP", "50000"))
        return max(v, 0)
    except ValueError:
        return 50000


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

    def run(self, messages, target, session, target_id,
            user_id=None, session_db_id=None):
        """SSE generator for web streaming. Auto-proceeds on destructive commands.

        OPS-4: `user_id` / `session_db_id` flow through to the LLM client so
        per-user token accounting and the per-run cap can attribute usage
        correctly. `session_db_id` is distinct from `target_id` — target_id
        is the cluster/target key, while session_db_id is the chat row.
        """
        # Send thinking event immediately so frontend knows we're alive
        yield f"data: {json.dumps({'status': 'thinking'})}\n\n"
        _current_cmd = None
        _cmd_start = None
        _full_text = ""
        _last_cmd = None  # most recent tool call, used by suggestion heuristics

        for event in self._run_internal(messages, target, session, target_id,
                                        user_id=user_id,
                                        session_db_id=session_db_id):
            t = event["type"]
            if t == "cmd":
                # Backward compat: old cmd event
                yield f"data: {json.dumps({'cmd': event['cmd']})}\n\n"
                # New: tool_start event for expandable tool-call blocks
                yield f"data: {json.dumps({'tool_start': {'cmd': event['cmd']}})}\n\n"
                _current_cmd = event["cmd"]
                _last_cmd = event["cmd"]
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
                _full_text += event["text"]
                yield f"data: {json.dumps({'t': event['text']})}\n\n"
            elif t == "error":
                yield f"data: {json.dumps({'error': event['msg']})}\n\n"
                yield "data: [DONE]\n\n"
                return
            elif t == "done":
                suggestions = _generate_suggestions(_full_text, _last_cmd)
                if suggestions:
                    yield f"data: {json.dumps({'suggestions': suggestions})}\n\n"
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
                      confirm_q=None, executor_fn=None,
                      user_id=None, session_db_id=None):
        """
        Core loop. Yields event dicts consumed by run_loop() or run().

        confirm_q   : Queue | None  — destructive commands pause for y/n (CLI only)
        executor_fn : callable | None — override ToolExecutor (CLI sandbox use)
        user_id / session_db_id : OPS-4 attribution — passed to each chat()
            call so the provider layer can record per-user token usage and
            enforce the per-run token cap.
        """
        commands_run = 0
        ran_commands = set()
        run_tokens = 0
        token_cap = _run_token_cap()

        for _ in range(MAX_STEPS):
            step_usage: dict = {}
            try:
                reply, command, tool_call_id = self._llm.chat(
                    messages, use_tools=True,
                    user_id=user_id, session_id=session_db_id,
                    usage_out=step_usage,
                )
            except Exception as e:
                yield {"type": "error", "msg": str(e)}
                return

            run_tokens += step_usage.get("total_tokens", 0)
            if token_cap and run_tokens > token_cap:
                yield {
                    "type": "error",
                    "msg": (
                        f"This run hit the per-request token cap "
                        f"({run_tokens} > {token_cap}). Aborting the loop to "
                        f"protect your daily budget. Try a narrower question."
                    ),
                }
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
                # RUN-3: instrument tool execution. `tool` label is the fixed
                # function name ("run_command") — NEVER the command text,
                # which would explode Prometheus cardinality. Metrics
                # emission is best-effort: a Prometheus-side failure must
                # never mask the original tool exception or abort success.
                _tool_t0 = time.monotonic()
                _tool_outcome = "ok"
                try:
                    output = (executor_fn(command) if executor_fn
                              else self._tools.execute(target, command))
                except Exception:
                    _tool_outcome = "error"
                    raise
                finally:
                    try:
                        record_tool_call(
                            "run_command",
                            time.monotonic() - _tool_t0,
                            _tool_outcome,
                        )
                    except Exception:
                        pass
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


# ── Follow-up suggestions ─────────────────────────────────────────────────────
#
# Heuristic follow-up generator. Rules mirror the K8s pod-failure incident
# response flow chart: each failure state maps to the specific diagnostic
# action that flow chart prescribes next, not generic "show logs" platitudes.
#
#   CrashLoopBackOff → previous logs (the new logs are already post-crash)
#   OOMKilled        → `kubectl top pod` + review resource limits
#   ImagePullBackOff → image tag + registry secret check
#   Evicted          → node disk/memory pressure
#   Pending          → events on pod → node pressure or quota
#
# Order matters: earlier, more specific rules win. The buckets are dedup'd
# and the final list is capped at 3.

_SUGGESTION_RULES = [
    # CrashLoopBackOff — the live logs are post-crash noise; previous-logs is
    # where the actual failure is captured.
    (
        ("crashloopbackoff", "crashloop"),
        [
            "Show the previous container logs",
            "What's causing the crash?",
            "Check the container's startup command and env",
        ],
    ),
    # OOMKilled — memory limits vs actual usage is the diagnostic pair.
    (
        ("oomkilled", "oom killed", "out of memory"),
        [
            "What are the memory limits on this pod?",
            "Show me kubectl top pod",
            "How do I safely raise the memory limit?",
        ],
    ),
    # ImagePullBackOff / ErrImagePull — wrong tag or missing registry secret.
    (
        ("imagepullbackoff", "errimagepull", "err image pull"),
        [
            "Verify the image tag exists",
            "Check the imagePullSecrets and registry auth",
            "Which node is trying to pull this image?",
        ],
    ),
    # Config errors at container creation time.
    (
        ("createcontainerconfigerror", "configmap", "secret not found",
         "invalidimagename"),
        [
            "Which ConfigMap or Secret is missing?",
            "Show the pod's full spec",
            "How do I recreate the missing resource?",
        ],
    ),
    # Evicted — check node pressure per the flow chart.
    (
        ("evicted", "disk pressure", "memory pressure", "diskpressure",
         "memorypressure"),
        [
            "Describe the node — is there disk or memory pressure?",
            "What's consuming disk on that node?",
            "Which pods can I safely reschedule?",
        ],
    ),
    # Pending / scheduling — walk the flow chart: events → node → quota.
    (
        ("pending", "unschedulable", "failedscheduling", "insufficient"),
        [
            "Show the pod events sorted by time",
            "Is it a node-resource or a quota issue?",
            "Check taints, tolerations and affinity",
        ],
    ),
    # Generic error wording — only used when no specific state matched.
    (
        ("error", "failed", "failure"),
        [
            "What should I check next?",
            "Show me the recent events",
            "Is this related to a recent change?",
        ],
    ),
    # Healthy / informational replies.
    (
        ("running", "ready", "healthy", "active"),
        [
            "Show me the resource usage",
            "Any recent events or restarts?",
            "What else should I check?",
        ],
    ),
]

_DEFAULT_SUGGESTIONS = ["Tell me more", "What should I do next?"]


def _generate_suggestions(text: str, last_cmd: str | None = None) -> list[str]:
    """
    Heuristic follow-up generator. Runs on the final assistant reply and picks
    up to 3 clickable prompts the user is likely to send next. Zero LLM cost.

    Skipped for very short replies (probably an error or refusal), since chips
    under a one-liner feel like noise.
    """
    if not text or len(text.strip()) < 40:
        return []

    lower = text.lower()
    picks: list[str] = []

    for keywords, candidates in _SUGGESTION_RULES:
        if any(k in lower for k in keywords):
            for c in candidates:
                if c not in picks:
                    picks.append(c)
            if len(picks) >= 3:
                break

    # If the last tool call was a read-only describe/get and we still have room,
    # drill into logs as a natural follow-up.
    if last_cmd and len(picks) < 3 and ("describe" in last_cmd or "get " in last_cmd):
        extra = "Tail the logs"
        if extra not in picks:
            picks.append(extra)

    if not picks:
        picks = list(_DEFAULT_SUGGESTIONS)

    return picks[:3]


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
    lines.append(f"  SEV1 (critical): {counts.get('SEV1', 0)}")
    lines.append(f"  SEV2 (warning):  {counts.get('SEV2', 0)}")
    lines.append(f"  SEV3 (info):     {counts.get('SEV3', 0)}")

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
