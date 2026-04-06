import { useState, useCallback, useRef } from "react";
import { api, readSSE } from "../api/client";

export interface ChatMsg {
  role:    "user" | "assistant";
  content: string;
  cmds?:   string[];
}

export function useTargetChat(targetId: string | null) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading,  setLoading]  = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (text: string) => {
    if (!targetId || !text.trim()) return;

    // Cancel any in-flight request before starting a new one
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setMessages((prev: ChatMsg[]) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    const placeholder: ChatMsg = { role: "assistant", content: "", cmds: [] };
    setMessages((prev: ChatMsg[]) => [...prev, placeholder]);

    try {
      const res = await api.chatStream(targetId, text, signal);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      let full = "";
      const cmds: string[] = [];

      for await (const evt of readSSE(res)) {
        if (signal.aborted) break;
        if (typeof evt.error === "string") {
          setMessages((prev: ChatMsg[]) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: `⚠ ${evt.error}` };
            return next;
          });
          return;
        }
        if (typeof evt.t === "string") {
          full += evt.t;
          setMessages((prev: ChatMsg[]) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: full, cmds };
            return next;
          });
        }
        if (typeof evt.cmd === "string") {
          cmds.push(evt.cmd);
          setMessages((prev: ChatMsg[]) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: full, cmds: [...cmds] };
            return next;
          });
        }
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setMessages((prev: ChatMsg[]) => {
        if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") return prev;
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: `Error: ${String(e)}` };
        return next;
      });
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
    const signal = abortRef.current.signal;

    setMessages(prev => [...prev, { role: "user", content: text }]);
    setLoading(true);

    const placeholder: ChatMsg = { role: "assistant", content: "" };
    setMessages(prev => [...prev, placeholder]);

    try {
      const res = await api.sessions.chatStream(sessionId, text, signal);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      let full = "";

      for await (const evt of readSSE(res)) {
        if (signal.aborted) break;
        if (typeof evt.error === "string") {
          setMessages(prev => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: `⚠ ${evt.error}` };
            return next;
          });
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
      if ((e as Error)?.name === "AbortError") return;
      setMessages(prev => {
        if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") return prev;
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: `Error: ${String(e)}` };
        return next;
      });
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
