import { useState, useEffect, useCallback } from "react";
import type { Target, ChatSession } from "../types";
import { useSessionChat, deleteSessionStore, setTitleUpdateCallback } from "../hooks/useChatStore";
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
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    api.sessions.list().then(s => {
      setSessions(s);
    }).catch(e => console.warn("[Chat] sessions.list failed:", (e as Error)?.message));

    // Register callback so AI-generated titles update the sidebar
    setTitleUpdateCallback((sid, title) => {
      setSessions(prev => prev.map(s => s.id === sid ? { ...s, title } : s));
    });
  }, []);

  const { messages, loading, send, retry, edit, clear, load } = useSessionChat(activeSession);

  const createSession = useCallback(async () => {
    const s = await api.sessions.create("New Chat");
    setSessions(prev => [s, ...prev]);
    setActiveSession(s.id);
    clear();
  }, [clear]);

  const deleteSession = useCallback(async (id: string) => {
    await api.sessions.remove(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    deleteSessionStore(id);
    if (activeSession === id) {
      setActiveSession(null);
    }
  }, [activeSession]);

  const switchSession = useCallback((id: string) => {
    setActiveSession(id);
    // load() checks if messages already exist in the store (e.g. from
    // an in-flight request) and only fetches from backend if empty
    load();
  }, [load]);

  // Auto-select first session on mount
  useEffect(() => {
    if (sessions.length > 0 && !activeSession) {
      setActiveSession(sessions[0].id);
    }
  }, [sessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load history when active session changes
  useEffect(() => {
    if (activeSession) load();
  }, [activeSession, load]);

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", margin: -1 }}>Chat</h1>

      {/* Session sidebar */}
      <div style={{
        width: 220, flexShrink: 0,
        borderRight: "1px solid var(--c-border)",
        background: "var(--c-bg-panel)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "12px 12px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--c-border)" }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, color: "var(--c-text-muted)", textTransform: "uppercase", letterSpacing: ".6px", margin: 0 }}>Conversations</h2>
          <button
            onClick={createSession}
            aria-label="New chat"
            title="New chat"
            style={{
              background: "var(--c-accent)", border: "none", color: "#fff", borderRadius: 6,
              width: 26, height: 26, fontSize: 16, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700,
            }}
          >+</button>
        </div>

        {/* Session list */}
        <ul aria-label="Chat sessions" style={{ flex: 1, overflowY: "auto", padding: "6px", margin: 0, listStyle: "none" }}>
          {sessions.length === 0 ? (
            <li style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: "24px 8px", lineHeight: 1.6 }}>
              Click <strong style={{ color: "var(--c-accent)" }}>+</strong> to start your first conversation
            </li>
          ) : sessions.map(s => {
            const isActive = activeSession === s.id;
            return (
              <li
                key={s.id}
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                onClick={() => switchSession(s.id)}
                onKeyDown={e => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    switchSession(s.id);
                  }
                }}
                style={{
                  padding: "9px 10px", borderRadius: 7, cursor: "pointer",
                  marginBottom: 2, fontSize: 12,
                  color: isActive ? "var(--c-text-primary)" : "var(--c-text-secondary)",
                  background: isActive ? "var(--c-bg-active)" : "transparent",
                  border: `1px solid ${isActive ? "var(--c-accent-dim)" : "transparent"}`,
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6,
                  transition: "all .15s",
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "var(--c-bg-surface)"; }}
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
                  aria-label={`Delete conversation ${s.title}`}
                  style={{
                    background: "none", border: "none", color: "var(--c-text-muted)",
                    fontSize: 15, cursor: "pointer", padding: "0 2px",
                    flexShrink: 0, lineHeight: 1,
                    opacity: isActive ? 1 : 0,
                    transition: "opacity .15s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                  onMouseLeave={e => (e.currentTarget.style.color = "var(--c-text-muted)")}
                  title="Delete"
                >×</button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Main chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          padding: "12px 20px", borderBottom: "1px solid var(--c-border)",
          display: "flex", alignItems: "center", gap: 12,
          flexShrink: 0, background: "var(--c-bg-raised)",
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
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-text-primary)" }}>AI Assistant</div>
            <div style={{ fontSize: 11, color: "var(--c-text-muted)" }}>Ask anything about DevOps, infrastructure, or Kubernetes</div>
          </div>
          {messages.length > 0 && (
            <button
              onClick={clear}
              style={{
                marginLeft: "auto", background: "transparent", border: "1px solid var(--c-border)",
                color: "var(--c-text-muted)", borderRadius: 6, padding: "5px 12px", fontSize: 11, cursor: "pointer",
              }}
            >Clear</button>
          )}
        </div>

        {!activeSession ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 14, color: "var(--c-text-muted)" }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: "#6366f118", border: "1px solid #6366f133", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent)" strokeWidth="1.8">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 15, color: "var(--c-text-secondary)", fontWeight: 600, marginBottom: 6 }}>No conversation selected</div>
              <div style={{ fontSize: 13 }}>Click <strong style={{ color: "var(--c-accent)" }}>+</strong> in the sidebar to start a new chat</div>
            </div>
          </div>
        ) : (
          <ChatPanel
            messages={messages}
            loading={loading}
            onSend={send}
            onRetry={retry}
            onEdit={edit}
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
