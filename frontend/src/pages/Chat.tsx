import { useState, useEffect, useCallback } from "react";
import type { Target, ChatSession } from "../types";
import { useSessionChat, deleteSessionStore, setTitleUpdateCallback } from "../hooks/useChatStore";
import { ChatPanel } from "../components/ChatPanel";
import { api } from "../api/client";
import { ConfirmDialog } from "../components/confirm-dialog";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT } from "../utils/theme";

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
          <h2 style={{ fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.bold, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".6px", margin: 0 }}>Conversations</h2>
          <button
            onClick={createSession}
            aria-label="New chat"
            title="New chat"
            style={{
              background: "var(--c-accent)", border: "none", color: "#fff", borderRadius: RADIUS.md,
              width: 26, height: 26, fontSize: FONT_SIZE.lg, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: FONT_WEIGHT.bold,
            }}
          >+</button>
        </div>

        {/* Session list */}
        <ul aria-label="Chat sessions" style={{ flex: 1, overflowY: "auto", padding: "6px", margin: 0, listStyle: "none" }}>
          {sessions.length === 0 ? (
            <li style={{ color: C.text.faint, fontSize: FONT_SIZE.sm, textAlign: "center", padding: `${SPACE.xxl}px ${SPACE.sm}px`, lineHeight: 1.6 }}>
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
                className={!isActive ? "hover-bg-raised" : undefined}
                style={{
                  padding: `${SPACE.sm}px ${SPACE.sm}px`, borderRadius: RADIUS.lg, cursor: "pointer",
                  marginBottom: SPACE.xxs, fontSize: FONT_SIZE.sm,
                  color: isActive ? "var(--c-text-primary)" : "var(--c-text-secondary)",
                  background: isActive ? "var(--c-bg-active)" : "transparent",
                  border: `1px solid ${isActive ? "var(--c-accent-dim)" : "transparent"}`,
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: SPACE.sm,
                  transition: "all .15s",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: isActive ? FONT_WEIGHT.semibold : FONT_WEIGHT.normal }}>
                    {s.title}
                  </div>
                  <div style={{ fontSize: FONT_SIZE.xs, color: C.text.faint, marginTop: SPACE.xxs }}>
                    {new Date(s.updated ?? s.created).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setConfirmDelete(s.id); }}
                  aria-label={`Delete conversation ${s.title}`}
                  className="hover-text-danger"
                  style={{
                    background: "none", border: "none", color: C.text.muted,
                    fontSize: FONT_SIZE.lg, cursor: "pointer", padding: `0 ${SPACE.xxs}px`,
                    flexShrink: 0, lineHeight: 1,
                    opacity: isActive ? 1 : 0,
                    transition: "opacity .15s",
                  }}
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
            width: 28, height: 28, borderRadius: RADIUS.lg,
            background: `${C.accent.primary}18`, border: `1px solid ${C.accent.primary}33`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent.light} strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: FONT_SIZE.lg, fontWeight: FONT_WEIGHT.semibold, color: C.text.primary }}>AI Assistant</div>
            <div style={{ fontSize: FONT_SIZE.sm, color: C.text.muted }}>Ask anything about DevOps, infrastructure, or Kubernetes</div>
          </div>
          {messages.length > 0 && (
            <button
              onClick={clear}
              style={{
                marginLeft: "auto", background: "transparent", border: `1px solid ${C.border.muted}`,
                color: C.text.muted, borderRadius: RADIUS.md, padding: `${SPACE.xs}px ${SPACE.md}px`, fontSize: FONT_SIZE.sm, cursor: "pointer",
              }}
            >Clear</button>
          )}
        </div>

        {!activeSession ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: SPACE.md, color: C.text.muted }}>
            <div style={{ width: 56, height: 56, borderRadius: RADIUS.xl, background: `${C.accent.primary}18`, border: `1px solid ${C.accent.primary}33`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent)" strokeWidth="1.8">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: FONT_SIZE.lg, color: C.text.secondary, fontWeight: FONT_WEIGHT.semibold, marginBottom: SPACE.sm }}>No conversation selected</div>
              <div style={{ fontSize: FONT_SIZE.md }}>Click <strong style={{ color: "var(--c-accent)" }}>+</strong> in the sidebar to start a new chat</div>
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
