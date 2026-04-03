"""
main.py — CLI entry point for Aziro Ops.
Mirrors cmd/main.go in kubectl-ai.

Usage
-----
  # basic interactive CLI
  python3 main.py

  # connect to a saved target by name or id
  python3 main.py --target my-server

  # start with event monitoring enabled (L1/L2/L3 auto-triage)
  python3 main.py --monitor

  # both
  python3 main.py --target prod-k8s --monitor

  # override model
  AI_MODEL=gemini-2.5-pro python3 main.py --monitor
"""
import argparse
import queue
import threading
import sys

from providers      import LLMClient
from tools          import ToolExecutor
from sandbox        import Sandbox
from targets        import TargetManager
from sessions       import SessionManager
from agent          import Agent, AgentSession
from ui.terminal    import TerminalUI
from monitor        import EventWatcher, Triage
from store          import EventStore
from prompts        import build_system_prompt


# ── CLI session uses a fixed target_id (no real target needed for local use) ──
_CLI_TARGET_ID = "__cli__"


def _parse_args():
    p = argparse.ArgumentParser(
        prog="aziro",
        description="Aziro Ops — AI-powered DevOps CLI",
    )
    p.add_argument("--target",  "-t", default=None,
                   help="Target name or ID from saved targets. Default: local sandbox.")
    p.add_argument("--monitor", "-m", action="store_true",
                   help="Enable continuous event monitoring with L1/L2/L3 auto-triage.")
    p.add_argument("--model",         default=None,
                   help="Override AI model (e.g. ollama/llama3.1:8b, gemini-2.5-pro).")
    return p.parse_args()


def _check_provider(llm):
    """Verify the configured model is reachable before starting."""
    for model in {llm.tool_model, llm.answer_model}:
        if "ollama" in model:
            import subprocess
            result = subprocess.run(
                "ollama list", shell=True, capture_output=True, text=True
            )
            if result.returncode != 0:
                print("ERROR: Ollama is not running. Start it with: ollama serve")
                sys.exit(1)
            name = model.split("/")[-1]
            if name not in result.stdout:
                print(f"ERROR: Model '{name}' not found. Run: ollama pull {name}")
                sys.exit(1)


def _resolve_target(args, targets: TargetManager):
    """
    Return (target_dict, target_id, executor_fn).

    If --target is given → look up in saved targets, use ToolExecutor.
    Otherwise           → use local sandbox.
    """
    if args.target:
        # search by name first, then by id
        all_targets = targets.load()
        match = next(
            (t for t in all_targets
             if t["name"] == args.target or t["id"] == args.target),
            None,
        )
        if not match:
            print(f"ERROR: Target '{args.target}' not found.")
            print("Saved targets:", [t["name"] for t in all_targets] or ["none"])
            sys.exit(1)
        tools      = ToolExecutor()
        target     = match
        target_id  = match["id"]
        executor   = lambda cmd: tools.execute(target, cmd)
        return target, target_id, executor

    # default: local sandbox
    sandbox    = Sandbox()
    target_id  = _CLI_TARGET_ID
    target     = {"type": "local", "config": {}}
    executor   = sandbox.execute
    return target, target_id, executor


def _build_cli_session(target, target_id):
    """
    Build a minimal AgentSession seeded with the system prompt.
    Mirrors Agent.Init() system prompt setup in pkg/agent/conversation.go:289.
    """
    session = AgentSession()
    # override get() to use build_system_prompt() for the CLI target
    system_prompt = build_system_prompt()
    session.set(target_id, [{"role": "system", "content": system_prompt}])
    return session


def main():
    args = _parse_args()

    # ── 1. Create all instances (mirrors RunRootCommand in cmd/main.go) ──────
    if args.model:
        import os
        os.environ["AI_MODEL"] = args.model

    llm     = LLMClient()
    targets = TargetManager()

    _check_provider(llm)

    target, target_id, executor_fn = _resolve_target(args, targets)
    session = _build_cli_session(target, target_id)
    agent   = Agent(llm, ToolExecutor())

    # ── 2. Create queues (Python equivalent of Go channels) ──────────────────
    # Mirrors: s.Input = make(chan any, 10) at pkg/agent/conversation.go:202
    in_q      = queue.Queue()    # TerminalUI → Agent
    out_q     = queue.Queue()    # Agent      → TerminalUI
    confirm_q = queue.Queue()    # TerminalUI → Agent (y/n for destructive cmds)

    # ── 3. Start agent loop in background thread ──────────────────────────────
    # Mirrors: go Agent.Run() at pkg/agent/conversation.go:385
    store = EventStore()

    agent_thread = threading.Thread(
        target=agent.run_loop,
        kwargs=dict(
            in_q=in_q, out_q=out_q, confirm_q=confirm_q,
            session=session, target_id=target_id,
            target=target, executor_fn=executor_fn,
            store=store,
        ),
        daemon=True,
        name="agent-loop",
    )
    agent_thread.start()

    # ── 4. Optionally start event monitor + triage ────────────────────────────
    watcher = None
    if args.monitor:
        triage  = Triage(in_q, out_q, executor_fn=executor_fn, store=store)
        watcher = EventWatcher(executor_fn)
        watcher.on_event(triage.handle)
        watcher.watch()
        print(f"  Monitoring: ON  (L1/L2/L3 auto-triage enabled)")

    # ── 5. Print startup info ─────────────────────────────────────────────────
    target_label = target.get("name", "local sandbox")
    if llm.tool_model == llm.answer_model:
        print(f"\nAziro Ops  —  {target_label}")
        print(f"  Model:    {llm.tool_model}")
    else:
        print(f"\nAziro Ops  —  {target_label}")
        print(f"  Tool model:   {llm.tool_model}")
        print(f"  Answer model: {llm.answer_model}")

    # ── 6. Start terminal UI in main thread (blocks until exit) ──────────────
    # Mirrors: go TerminalUI.Run() at pkg/ui/terminal.go:143
    ui = TerminalUI(in_q, out_q, confirm_q)
    ui.run()

    # ── 7. Cleanup ────────────────────────────────────────────────────────────
    if watcher:
        watcher.stop()


if __name__ == "__main__":
    main()
