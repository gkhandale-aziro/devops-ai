/**
 * useChatStore.ts — Module-level chat state that survives navigation.
 *
 * The SSE stream runs outside React's lifecycle. Components subscribe
 * to state changes via useSyncExternalStore. Navigating away does NOT
 * abort the in-flight request — the response completes in the background
 * and is available when the user returns.
 */
import { useSyncExternalStore, useCallback } from "react";
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

// ── Module-level state (lives outside React) ─────────────────────────────────

interface SessionState {
  messages: ChatMsg[];
  loading:  boolean;
}

const _sessions = new Map<string, SessionState>();
const _listeners = new Set<() => void>();

// In-flight abort controllers — keyed by session id
const _aborts = new Map<string, AbortController>();

function _notify() {
  _listeners.forEach(fn => fn());
}

function _getState(sid: string): SessionState {
  let s = _sessions.get(sid);
  if (!s) {
    s = { messages: [], loading: false };
    _sessions.set(sid, s);
  }
  return s;
}

function _setState(sid: string, update: Partial<SessionState>) {
  const s = _getState(sid);
  Object.assign(s, update);
  _notify();
}

function _setLastMessage(sid: string, msg: ChatMsg) {
  const s = _getState(sid);
  if (s.messages.length > 0) {
    s.messages[s.messages.length - 1] = msg;
    _notify();
  }
}

// ── Timeout helper ───────────────────────────────────────────────────────────

const RESPONSE_TIMEOUT_MS = 45_000;
const STREAM_STALL_MS     = 60_000;

function createTimedAbort(ms: number): [AbortController, () => void] {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(new Error("Request timed out")), ms);
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error("Stream stalled")), STREAM_STALL_MS);
  };
  return [controller, reset];
}

// ── Send message (runs outside React) ────────────────────────────────────────

async function sendMessage(sid: string, text: string) {
  if (!text.trim()) return;

  // Cancel any in-flight request for this session
  _aborts.get(sid)?.abort();

  const state = _getState(sid);
  state.messages = [
    ...state.messages,
    { role: "user", content: text },
    { role: "assistant", content: "" },
  ];
  state.loading = true;
  _notify();

  const [controller, resetTimer] = createTimedAbort(RESPONSE_TIMEOUT_MS);
  _aborts.set(sid, controller);

  try {
    const res = await api.sessions.chatStream(sid, text, controller.signal);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

    let full = "";
    for await (const evt of readSSE(res)) {
      if (controller.signal.aborted) break;
      resetTimer();

      if (typeof evt.error === "string") {
        _setLastMessage(sid, { role: "assistant", content: `Error: ${evt.error}` });
        return;
      }
      if (typeof evt.t === "string") {
        full += evt.t;
        _setLastMessage(sid, { role: "assistant", content: full });
      }
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      // Only show error if it was a timeout, not user-initiated clear
      const msg = String((e as Error)?.message ?? "");
      if (msg.includes("timed out") || msg.includes("stalled")) {
        _setLastMessage(sid, { role: "assistant", content: "Error: Request timed out — AI model may be overloaded. Try again." });
      }
      return;
    }
    _setLastMessage(sid, { role: "assistant", content: `Error: ${String(e)}` });
  } finally {
    _setState(sid, { loading: false });
    _aborts.delete(sid);
  }
}

// ── Load history from backend ────────────────────────────────────────────────

async function loadHistory(sid: string) {
  const state = _getState(sid);
  // Don't reload if we already have messages (e.g. in-flight or loaded)
  if (state.messages.length > 0) return;

  _setState(sid, { loading: true });
  try {
    const msgs = await api.sessions.messages(sid);
    const chatMsgs: ChatMsg[] = msgs
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
    _setState(sid, { messages: chatMsgs, loading: false });
  } catch {
    _setState(sid, { loading: false });
  }
}

function clearSession(sid: string) {
  _aborts.get(sid)?.abort();
  _aborts.delete(sid);
  _sessions.delete(sid);
  _notify();
}

function deleteSession(sid: string) {
  clearSession(sid);
}

// ── React hook ───────────────────────────────────────────────────────────────

function getSnapshot(): Map<string, SessionState> {
  return _sessions;
}

function subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

export function useSessionChat(sessionId: string | null) {
  // Subscribe to store changes
  const store = useSyncExternalStore(subscribe, getSnapshot);

  const state = sessionId ? store.get(sessionId) : undefined;
  const messages = state?.messages ?? [];
  const loading  = state?.loading ?? false;

  const send = useCallback((text: string) => {
    if (sessionId) sendMessage(sessionId, text);
  }, [sessionId]);

  const clear = useCallback(() => {
    if (sessionId) clearSession(sessionId);
  }, [sessionId]);

  const load = useCallback(() => {
    if (sessionId) loadHistory(sessionId);
  }, [sessionId]);

  return { messages, loading, send, clear, load };
}

// Re-export for convenience
export { deleteSession as deleteSessionStore };
