import { useState, useCallback } from "react";
import { api, readSSE } from "../api/client";

export interface ChatMsg {
  role:    "user" | "assistant";
  content: string;
  cmds?:   string[];
}

export function useTargetChat(targetId: string | null) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading,  setLoading]  = useState(false);

  const send = useCallback(async (text: string) => {
    if (!targetId || !text.trim()) return;

    setMessages((prev: ChatMsg[]) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    const placeholder: ChatMsg = { role: "assistant", content: "", cmds: [] };
    setMessages((prev: ChatMsg[]) => [...prev, placeholder]);

    try {
      const res = await api.chatStream(targetId, text);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      let full = "";
      const cmds: string[] = [];

      for await (const evt of readSSE(res)) {
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

  const clear = useCallback(() => setMessages([]), []);

  return { messages, loading, send, clear };
}
