"""
ui/terminal.py — CLI interface for Aziro Ops.
Mirrors pkg/ui/terminal.go in kubectl-ai.

Two threads running concurrently:
  output thread : reads agent out_q, prints events to terminal
  main thread   : readline loop, sends queries to agent in_q

Three queues (Python equivalent of Go channels):
  in_q      : TerminalUI → Agent     queries
  out_q     : Agent → TerminalUI     text / cmd / confirm / done / auto_start / alert
  confirm_q : TerminalUI → Agent     True/False for destructive command confirmation
"""
import sys
import threading

# ── terminal colours ─────────────────────────────────────────────────────────
_RESET  = "\033[0m"
_BOLD   = "\033[1m"
_GREEN  = "\033[32m"
_YELLOW = "\033[33m"
_RED    = "\033[31m"
_CYAN   = "\033[36m"
_DIM    = "\033[2m"


class TerminalUI:
    """
    CLI display and input loop.
    Mirrors TerminalUI struct in pkg/ui/terminal.go.

    Usage
    -----
        ui = TerminalUI(in_q, out_q, confirm_q)
        ui.run()     # blocks — call from main thread
    """

    def __init__(self, in_q, out_q, confirm_q):
        self._in_q      = in_q
        self._out_q     = out_q
        self._confirm_q = confirm_q
        self._ready     = threading.Event()
        self._at_prompt = False    # True when readline is waiting for input

    def run(self):
        """Start output handler in background, run readline loop in this thread."""
        t = threading.Thread(target=self._handle_output, daemon=True)
        t.start()
        self._readline_loop()

    # ── readline-safe print ───────────────────────────────────────────────────

    def _safe_print(self, text, end="\n"):
        """
        Print without corrupting the readline input line.
        If the user is currently at the >>> prompt, erase that line first,
        print the message, then the prompt will be redrawn on the next Enter.
        """
        if self._at_prompt:
            sys.stdout.write("\r\033[2K")   # carriage-return + erase line
        sys.stdout.write(text + end)
        sys.stdout.flush()

    # ── output thread ────────────────────────────────────────────────────────

    def _handle_output(self):
        """
        Reads events from out_q and renders them.
        Mirrors handleMessage() in pkg/ui/terminal.go:246.
        """
        while True:
            event = self._out_q.get()
            etype = event.get("type")

            if etype == "ready":
                self._ready.set()

            elif etype == "auto_start":
                # auto-monitor query starting — show label so user knows why output appears
                label = event.get("label", "")
                self._safe_print(f"\n{_CYAN}{_BOLD}  [AUTO-MONITOR]{_RESET} {label}")

            elif etype == "cmd":
                self._safe_print(f"\n{_CYAN}  ▶ Running{_RESET}  {event['cmd']}")

            elif etype == "tool_output":
                output = event.get("output", "").strip()
                lines  = output.split("\n")
                shown  = lines[:25]
                for line in shown:
                    self._safe_print(f"  {_DIM}{line}{_RESET}")
                if len(lines) > 25:
                    self._safe_print(f"  {_DIM}... ({len(lines)-25} more lines){_RESET}")

            elif etype == "text":
                # streaming — no newline, flush immediately
                sys.stdout.write(f"{_GREEN}{event['text']}{_RESET}")
                sys.stdout.flush()

            elif etype == "confirm":
                # destructive command — ask y/n in output thread
                cmd = event["cmd"]
                self._safe_print(f"\n{_YELLOW}{_BOLD}  ⚠  Destructive command{_RESET}")
                self._safe_print(f"  {_RED}{cmd}{_RESET}")
                try:
                    ans = input(f"  Run it? (y/n): ").strip().lower()
                except (EOFError, KeyboardInterrupt):
                    ans = "n"
                self._confirm_q.put(ans == "y")

            elif etype == "done":
                sys.stdout.write("\n")
                sys.stdout.flush()
                self._ready.set()   # ready for next query

            elif etype == "error":
                self._safe_print(f"\n{_RED}  [ERROR]{_RESET} {event['msg']}\n")
                self._ready.set()

            elif etype == "monitor_alert":
                self._print_alert(event)

    def _print_alert(self, event):
        level   = event.get("level", "SEV3")
        summary = event.get("summary", "")
        color   = _RED if level == "SEV1" else _YELLOW if level == "SEV2" else _CYAN
        self._safe_print(f"\n{color}{_BOLD}  [{level}]{_RESET} {summary}")
        if event.get("auto_investigate"):
            self._safe_print(f"  {_DIM}Investigating...{_RESET}")

    # ── readline loop (main thread) ──────────────────────────────────────────

    def _readline_loop(self):
        """
        Show >>> prompt and read user input.
        Mirrors rlInstance.Readline() in pkg/ui/terminal.go:329.
        """
        print(f"\n{_DIM}Type exit to quit.{_RESET}\n")

        while True:
            self._ready.wait()
            self._ready.clear()

            self._at_prompt = True
            try:
                query = input(f"{_GREEN}>>> {_RESET}").strip()
            except (EOFError, KeyboardInterrupt):
                print(f"\n{_DIM}Goodbye!{_RESET}")
                self._in_q.put(None)
                break
            finally:
                self._at_prompt = False

            if not query:
                self._ready.set()
                continue

            if query.lower() in ("exit", "quit"):
                print(f"{_DIM}Goodbye!{_RESET}")
                self._in_q.put(None)
                break

            if query.lower() == "clear":
                print("\033[2J\033[H", end="")
                self._ready.set()
                continue

            # send to agent — mirrors terminal.go:346  agent.Input <- query
            self._in_q.put({"type": "query", "text": query})
