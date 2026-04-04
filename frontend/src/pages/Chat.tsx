import { useState, useEffect, useCallback } from "react";
import type { Target, ChatSession } from "../types";
import { useSessionChat } from "../hooks/useChat";
import { ChatPanel } from "../components/ChatPanel";
import { api } from "../api/client";

interface Props {
  targets: Target[];
  activeTarget: Target | null;
}

export function Chat(_props: Props) {
  const [sessions, setSessions]       = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);

  // Load sessions on mount
  useEffect(() => {
    api.sessions.list().then(setSessions).catch(() => {});
  }, []);

  const { messages, loading, send, clear } = useSessionChat(activeSession);

  const createSession = useCallback(async () => {
    const title = `Chat ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    const s = await api.sessions.create(title);
    setSessions(prev => [s, ...prev]);
    setActiveSession(s.id);
    clear();
  }, [clear]);

  const deleteSession = useCallback(async (id: string) => {
    await api.sessions.remove(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSession === id) { setActiveSession(null); clear(); }
  }, [activeSession, clear]);

  const switchSession = useCallback(async (id: string) => {
    setActiveSession(id);
    clear();
    try {
      await api.sessions.messages(id);
    } catch {}
  }, [clear]);

  // Auto-create a session if none exist
  useEffect(() => {
    if (sessions.length === 0) return;
    if (!activeSession) setActiveSession(sessions[0].id);
  }, [sessions, activeSession]);

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

      {/* Session sidebar */}
      <div style={{
        width: 220, flexShrink: 0, borderRight: "1px solid #1e2235", background: "#0b0e14",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ padding: "12px 12px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>Conversations</span>
          <button
            onClick={createSession}
            title="New chat"
            style={{
              background: "#7c8cf8", border: "none", color: "#fff", borderRadius: 6,
              width: 26, height: 26, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >+</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 6px" }}>
          {sessions.map(s => (
            <div
              key={s.id}
              onClick={() => switchSession(s.id)}
              style={{
                padding: "8px 10px", borderRadius: 6, cursor: "pointer", marginBottom: 2,
                fontSize: 12, color: activeSession === s.id ? "#e2e8f0" : "#94a3b8",
                background: activeSession === s.id ? "#1a1d27" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{s.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                style={{ background: "none", border: "none", color: "#64748b", fontSize: 14, cursor: "pointer", padding: "0 2px", flexShrink: 0 }}
                title="Delete"
              >×</button>
            </div>
          ))}
          {sessions.length === 0 && (
            <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: "20px 8px" }}>
              Click + to start a new chat
            </div>
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          padding: "10px 20px", borderBottom: "1px solid #1e2235",
          display: "flex", alignItems: "center", gap: 12, flexShrink: 0, background: "#0f1219",
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c8cf8" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <strong style={{ fontSize: 15 }}>AI Assistant</strong>
          <span style={{ fontSize: 12, color: "#64748b" }}>General DevOps chat — ask anything</span>
          {messages.length > 0 && (
            <button
              onClick={clear}
              style={{
                marginLeft: "auto", background: "#1a1d27", border: "1px solid #2d3148",
                color: "#64748b", borderRadius: 6, padding: "5px 12px", fontSize: 11, cursor: "pointer",
              }}
            >Clear</button>
          )}
        </div>

        {!activeSession ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, color: "#64748b" }}>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#2d3148" strokeWidth="1.2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <div style={{ fontSize: 16, color: "#94a3b8", fontWeight: 600 }}>Start a new conversation</div>
            <div style={{ fontSize: 13 }}>Click the <strong style={{ color: "#7c8cf8" }}>+</strong> button to begin chatting with the AI assistant.</div>
          </div>
        ) : (
          <ChatPanel
            messages={messages}
            loading={loading}
            onSend={send}
            placeholder="Ask anything about DevOps, infrastructure, troubleshooting…"
          />
        )}
      </div>
    </div>
  );
}
