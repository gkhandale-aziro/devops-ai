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

// ── Title update callback ───────────────────────────────────────────────────
// Set by Chat.tsx so the session list can update when the AI generates a title
let _onTitleUpdate: ((sid: string, title: string) => void) | null = null;

export function setTitleUpdateCallback(cb: (sid: string, title: string) => void) {
  _onTitleUpdate = cb;
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

// Version counter — incremented on every state change so useSyncExternalStore
// detects a new snapshot (it compares by reference via Object.is)
let _version = 0;

function _notify() {
  _version++;
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

const RESPONSE_TIMEOUT_MS = 120_000;
const STREAM_STALL_MS     = 120_000;

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

      // Backend sends {status:"thinking"} immediately — reset timer
      if (typeof evt.status === "string") continue;
      if (typeof evt.error === "string") {
        _setLastMessage(sid, { role: "assistant", content: `Error: ${evt.error}` });
        return;
      }
      if (typeof evt.title === "string") {
        _onTitleUpdate?.(sid, evt.title as string);
        continue;
      }
      if (typeof evt.t === "string") {
        full += evt.t;
        _setLastMessage(sid, { role: "assistant", content: full });
      }
    }
    // Safety net: if stream ended but no content arrived, show error
    if (!full.trim()) {
      _setLastMessage(sid, { role: "assistant", content: "Error: No response from AI — model may be unavailable. Try again." });
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
    _setLastMessage(sid, { role: "assistant", content: `Error: ${(e as Error)?.message ?? String(e)}` });
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

/** Retry: remove the last assistant error + re-send the last user message. */
function retryLast(sid: string) {
  const state = _getState(sid);
  const msgs = state.messages;
  // Find last user message (skip trailing assistant error)
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") { lastUserIdx = i; break; }
  }
  if (lastUserIdx < 0) return;
  const text = msgs[lastUserIdx].content;
  // Remove the user message + everything after it (the error response)
  state.messages = msgs.slice(0, lastUserIdx);
  _notify();
  sendMessage(sid, text);
}

/** Edit: replace messages from index onward, re-send with new text. */
function editAndResend(sid: string, msgIndex: number, newText: string) {
  if (!newText.trim()) return;
  const state = _getState(sid);
  // Truncate to before the edited message
  state.messages = state.messages.slice(0, msgIndex);
  _notify();
  sendMessage(sid, newText);
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

function getSnapshot(): number {
  return _version;
}

function subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

export function useSessionChat(sessionId: string | null) {
  // Subscribe to store changes — version number changes on every _notify(),
  // which tells React to re-render. We read state directly from the module map.
  useSyncExternalStore(subscribe, getSnapshot);

  const state = sessionId ? _sessions.get(sessionId) : undefined;
  const messages = state?.messages ?? [];
  const loading  = state?.loading ?? false;

  const send = useCallback((text: string) => {
    if (sessionId) sendMessage(sessionId, text);
  }, [sessionId]);

  const retry = useCallback(() => {
    if (sessionId) retryLast(sessionId);
  }, [sessionId]);

  const edit = useCallback((msgIndex: number, newText: string) => {
    if (sessionId) editAndResend(sessionId, msgIndex, newText);
  }, [sessionId]);

  const clear = useCallback(() => {
    if (sessionId) clearSession(sessionId);
  }, [sessionId]);

  const load = useCallback(() => {
    if (sessionId) loadHistory(sessionId);
  }, [sessionId]);

  return { messages, loading, send, retry, edit, clear, load };
}

// Re-export for convenience
export { deleteSession as deleteSessionStore };
