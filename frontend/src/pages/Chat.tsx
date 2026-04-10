import { useState, useEffect, useCallback } from "react";
import type { Target, ChatSession } from "../types";
import type { ChatMsg } from "../hooks/useChat";
import { useSessionChat } from "../hooks/useChat";
import { ChatPanel } from "../components/ChatPanel";
import { api } from "../api/client";
import { ConfirmDialog } from "../components/confirm-dialog";

interface Props {
  targets:       Target[];
  activeTarget:  Target | null;
}

export function Chat(_props: Props) {
  const [sessions,      setSessions]      = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [history,       setHistory]       = useState<ChatMsg[]>([]);
  const [histLoading,   setHistLoading]   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    api.sessions.list().then(s => {
      setSessions(s);
    }).catch(e => console.warn("[Chat] sessions.list failed:", (e as Error)?.message));
  }, []);

  const { messages, loading, send, clear } = useSessionChat(activeSession);

  const createSession = useCallback(async () => {
    const title = `Chat ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    const s = await api.sessions.create(title);
    setSessions(prev => [s, ...prev]);
    setHistory([]);
    setActiveSession(s.id);
    clear();
  }, [clear]);

  const deleteSession = useCallback(async (id: string) => {
    await api.sessions.remove(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSession === id) {
      setActiveSession(null);
      setHistory([]);
      clear();
    }
  }, [activeSession, clear]);

  const switchSession = useCallback(async (id: string) => {
    setActiveSession(id);
    setHistory([]);
    clear();
    setHistLoading(true);
    try {
      const msgs = await api.sessions.messages(id);
      const chatMsgs: ChatMsg[] = msgs
        .filter(m => m.role !== "system")
        .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
      setHistory(chatMsgs);
    } catch {
      setHistory([]);
    } finally {
      setHistLoading(false);
    }
  }, [clear]);

  // Auto-select first session — placed after switchSession to avoid used-before-declared error
  useEffect(() => {
    if (sessions.length > 0 && !activeSession) {
      switchSession(sessions[0].id);
    }
  }, [sessions, switchSession]);

  // Combine history with live messages (dedup by showing history only when live is empty)
  const displayMessages = messages.length > 0 ? messages : history;

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

      {/* Session sidebar */}
      <div style={{
        width: 220, flexShrink: 0,
        borderRight: "1px solid #1e2235",
        background: "#0b0d14",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "12px 12px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #1e2235" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".6px" }}>Conversations</span>
          <button
            onClick={createSession}
            title="New chat"
            style={{
              background: "#6366f1", border: "none", color: "#fff", borderRadius: 6,
              width: 26, height: 26, fontSize: 16, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700,
            }}
          >+</button>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "6px" }}>
          {sessions.length === 0 ? (
            <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: "24px 8px", lineHeight: 1.6 }}>
              Click <strong style={{ color: "#6366f1" }}>+</strong> to start your first conversation
            </div>
          ) : sessions.map(s => {
            const isActive = activeSession === s.id;
            return (
              <div
                key={s.id}
                onClick={() => switchSession(s.id)}
                style={{
                  padding: "9px 10px", borderRadius: 7, cursor: "pointer",
                  marginBottom: 2, fontSize: 12,
                  color: isActive ? "#e2e8f0" : "#94a3b8",
                  background: isActive ? "#1e2340" : "transparent",
                  border: `1px solid ${isActive ? "#6366f144" : "transparent"}`,
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6,
                  transition: "all .15s",
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "#161b27"; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: isActive ? 600 : 400 }}>
                    {s.title}
                  </div>
                  <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
                    {new Date(s.updated ?? s.created).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setConfirmDelete(s.id); }}
                  style={{
                    background: "none", border: "none", color: "#64748b",
                    fontSize: 15, cursor: "pointer", padding: "0 2px",
                    flexShrink: 0, lineHeight: 1,
                    opacity: isActive ? 1 : 0,
                    transition: "opacity .15s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                  onMouseLeave={e => (e.currentTarget.style.color = "#64748b")}
                  title="Delete"
                >×</button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          padding: "12px 20px", borderBottom: "1px solid #1e2235",
          display: "flex", alignItems: "center", gap: 12,
          flexShrink: 0, background: "#0f1219",
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: "#6366f118", border: "1px solid #6366f133",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>AI Assistant</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Ask anything about DevOps, infrastructure, or Kubernetes</div>
          </div>
          {messages.length > 0 && (
            <button
              onClick={() => { clear(); setHistory([]); }}
              style={{
                marginLeft: "auto", background: "transparent", border: "1px solid #1e2235",
                color: "#64748b", borderRadius: 6, padding: "5px 12px", fontSize: 11, cursor: "pointer",
              }}
            >Clear</button>
          )}
        </div>

        {!activeSession ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 14, color: "#64748b" }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: "#6366f118", border: "1px solid #6366f133", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.8">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 15, color: "#94a3b8", fontWeight: 600, marginBottom: 6 }}>No conversation selected</div>
              <div style={{ fontSize: 13 }}>Click <strong style={{ color: "#6366f1" }}>+</strong> in the sidebar to start a new chat</div>
            </div>
          </div>
        ) : histLoading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 13, gap: 8 }}>
            <span style={{ width: 14, height: 14, border: "2px solid #1e2235", borderTopColor: "#6366f1", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />
            Loading conversation…
          </div>
        ) : (
          <ChatPanel
            messages={displayMessages}
            loading={loading}
            onSend={send}
            placeholder="Ask anything about DevOps, infrastructure, troubleshooting…"
          />
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}
        title="Delete conversation?"
        description="This conversation will be permanently deleted."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => { if (confirmDelete) { deleteSession(confirmDelete); setConfirmDelete(null); } }}
        variant="destructive"
      />
    </div>
  );
}
