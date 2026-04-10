import { useState, useCallback, useRef } from "react";
import { api, readSSE } from "../api/client";

export interface ToolCall {
  cmd:       string;
  output?:   string;
  duration?: number;
  status:    "running" | "done" | "error";
}

export interface ChatMsg {
  role:    "user" | "assistant";
  content: string;
  cmds?:   string[];
  tools?:  ToolCall[];
}

/** Timeout for initial server response (covers AI model latency + failover). */
const RESPONSE_TIMEOUT_MS = 120_000;

/** Timeout for silence during SSE streaming (no data for this long = stall). */
const STREAM_STALL_MS = 120_000;

/**
 * Create an AbortController that auto-aborts after `ms` milliseconds.
 * Returns [controller, resetTimer] — call resetTimer() on each SSE chunk
 * to prevent stall timeout while data is still flowing.
 */
function createTimedAbort(existingSignal: AbortSignal, ms: number): [AbortController, () => void] {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(new Error("Request timed out")), ms);

  // If the parent signal aborts, abort this one too
  existingSignal.addEventListener("abort", () => controller.abort(existingSignal.reason));

  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error("Stream stalled — no data received")), STREAM_STALL_MS);
  };

  return [controller, reset];
}

function setError(setMessages: React.Dispatch<React.SetStateAction<ChatMsg[]>>, msg: string) {
  setMessages(prev => {
    if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") return prev;
    const next = [...prev];
    next[next.length - 1] = { role: "assistant", content: msg };
    return next;
  });
}

export function useTargetChat(targetId: string | null) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading,  setLoading]  = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (text: string) => {
    if (!targetId || !text.trim()) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const userSignal = abortRef.current.signal;

    setMessages((prev: ChatMsg[]) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    const placeholder: ChatMsg = { role: "assistant", content: "", cmds: [], tools: [] };
    setMessages((prev: ChatMsg[]) => [...prev, placeholder]);

    const [timedController, resetTimer] = createTimedAbort(userSignal, RESPONSE_TIMEOUT_MS);

    try {
      const res = await api.chatStream(targetId, text, timedController.signal);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      let full = "";
      const cmds: string[] = [];
      const tools: ToolCall[] = [];

      for await (const evt of readSSE(res)) {
        if (timedController.signal.aborted) break;
        resetTimer(); // got data, reset stall timer

        // Backend sends {status:"thinking"} immediately — reset timer
        if (typeof evt.status === "string") continue;
        if (typeof evt.error === "string") {
          setError(setMessages, `Error: ${evt.error}`);
          return;
        }
        if (typeof evt.t === "string") {
          full += evt.t;
          setMessages((prev: ChatMsg[]) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: full, cmds: [...cmds], tools: [...tools] };
            return next;
          });
        }
        if (typeof evt.cmd === "string") {
          cmds.push(evt.cmd);
        }
        if (evt.tool_start) {
          const tc = evt.tool_start as { cmd: string };
          tools.push({ cmd: tc.cmd, status: "running" });
          setMessages((prev: ChatMsg[]) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: full, cmds: [...cmds], tools: [...tools] };
            return next;
          });
        }
        if (evt.tool_end) {
          const tc = evt.tool_end as { cmd: string; output?: string; duration_ms?: number; status?: string };
          const idx = tools.findIndex(t => t.cmd === tc.cmd && t.status === "running");
          if (idx >= 0) {
            tools[idx] = {
              cmd: tc.cmd,
              output: tc.output,
              duration: tc.duration_ms,
              status: (tc.status === "error" ? "error" : "done") as ToolCall["status"],
            };
          }
          setMessages((prev: ChatMsg[]) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: full, cmds: [...cmds], tools: [...tools] };
            return next;
          });
        }
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        // Check if this was a timeout abort (not user-initiated)
        if (!userSignal.aborted) {
          setError(setMessages, "Error: Request timed out — AI model may be overloaded. Try again.");
        }
        return;
      }
      setError(setMessages, `Error: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
  }, []);

  return { messages, loading, send, clear };
}

export function useSessionChat(sessionId: string | null) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading,  setLoading]  = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (text: string) => {
    if (!sessionId || !text.trim()) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const userSignal = abortRef.current.signal;

    setMessages(prev => [...prev, { role: "user", content: text }]);
    setLoading(true);

    const placeholder: ChatMsg = { role: "assistant", content: "" };
    setMessages(prev => [...prev, placeholder]);

    const [timedController, resetTimer] = createTimedAbort(userSignal, RESPONSE_TIMEOUT_MS);

    try {
      const res = await api.sessions.chatStream(sessionId, text, timedController.signal);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      let full = "";

      for await (const evt of readSSE(res)) {
        if (timedController.signal.aborted) break;
        resetTimer();

        // Backend sends {status:"thinking"} immediately — reset timer
        if (typeof evt.status === "string") continue;
        if (typeof evt.error === "string") {
          setError(setMessages, `Error: ${evt.error}`);
          return;
        }
        if (typeof evt.t === "string") {
          full += evt.t;
          setMessages(prev => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: full };
            return next;
          });
        }
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        if (!userSignal.aborted) {
          setError(setMessages, "Error: Request timed out — AI model may be overloaded. Try again.");
        }
        return;
      }
      setError(setMessages, `Error: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
  }, []);

  return { messages, loading, send, clear };
}
