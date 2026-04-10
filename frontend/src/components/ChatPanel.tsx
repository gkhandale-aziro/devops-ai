import { useState, useRef, useEffect } from "react";
import { Check, X as XIcon, ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, RotateCcw, Pencil } from "lucide-react";
import type { ChatMsg, ToolCall } from "../hooks/useChat";
import { Markdown } from "./Markdown";
import { C } from "../utils/theme";
import { api } from "../api/client";

interface Props {
  messages:     ChatMsg[];
  loading:      boolean;
  onSend:       (text: string) => void;
  onRetry?:     () => void;
  onEdit?:      (msgIndex: number, newText: string) => void;
  placeholder?: string;
  targetId?:    string;
}

export function ChatPanel({ messages, loading, onSend, onRetry, onEdit, placeholder, targetId }: Props) {
  const [text,    setText]    = useState("");
  const [focused, setFocused] = useState(false);
  const [ratings, setRatings] = useState<Record<number, "up" | "down">>({});
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText,   setEditText]   = useState("");

  function handleFeedback(msgIndex: number, content: string, rating: "up" | "down") {
    if (ratings[msgIndex]) return; // already rated
    setRatings(prev => ({ ...prev, [msgIndex]: rating }));
    if (targetId) {
      api.feedback(targetId, content, rating).catch(e => console.warn("[Feedback] save failed:", e));
    }
  }
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages]);

  function submit() {
    const t = text.trim();
    if (!t || loading) return;
    setText("");
    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = "auto";
    onSend(t);
  }

  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    // Auto-grow
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  }

  const visibleMessages = messages;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", flex: 1, overflow: "hidden" }}>

      {/* Messages feed */}
      <div ref={feedRef} style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {visibleMessages.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 14, color: "var(--c-text-muted)", paddingTop: 40 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: `${C.accent.primary}18`, border: `1px solid ${C.accent.primary}33`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.accent.light} strokeWidth="1.8">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, color: "var(--c-text-secondary)", fontWeight: 600, marginBottom: 4 }}>AI Assistant</div>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                {placeholder ?? "Ask anything about this target…"}
              </div>
            </div>
          </div>
        )}

        {visibleMessages.map((m, i) => {
          const isUser = m.role === "user";
          const isLast = i === visibleMessages.length - 1;

          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", gap: 4, animation: "fadeIn .2s ease-out" }}>
              {/* Role label */}
              <div style={{ fontSize: 10, color: C.text.faint, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 600, paddingLeft: isUser ? 0 : 4 }}>
                {isUser ? "You" : "Aziro AI"}
              </div>

              {/* Bubble */}
              <div style={{
                maxWidth: "82%",
                background: isUser ? "linear-gradient(135deg,#6366f1,#818cf8)" : "var(--c-bg-surface)",
                border: isUser ? "none" : "1px solid var(--c-border)",
                borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                padding: "10px 14px",
                fontSize: 13,
                lineHeight: 1.65,
                color: "var(--c-text-primary)",
                position: "relative",
              }}>
                {isUser && editingIdx === i ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <textarea
                      autoFocus
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (editText.trim() && onEdit) { onEdit(i, editText.trim()); setEditingIdx(null); }
                        }
                        if (e.key === "Escape") setEditingIdx(null);
                      }}
                      style={{
                        background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
                        borderRadius: 6, padding: "6px 8px", color: "#fff",
                        fontSize: 13, fontFamily: "inherit", resize: "none",
                        outline: "none", minHeight: 36, lineHeight: 1.5,
                      }}
                      rows={2}
                    />
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button onClick={() => setEditingIdx(null)} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 4, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>Cancel</button>
                      <button onClick={() => { if (editText.trim() && onEdit) { onEdit(i, editText.trim()); setEditingIdx(null); } }} style={{ background: "#fff", border: "none", color: "#6366f1", borderRadius: 4, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Send</button>
                    </div>
                  </div>
                ) : isUser ? (
                  <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.content}</span>
                ) : m.content ? (
                  <Markdown>{m.content}</Markdown>
                ) : loading && isLast ? (
                  <ThinkingDots />
                ) : "—"}
              </div>

              {/* Edit & Retry buttons on user messages */}
              {isUser && editingIdx !== i && !loading && (
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {onEdit && (
                    <button
                      onClick={() => { setEditingIdx(i); setEditText(m.content); }}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        padding: 3, borderRadius: 4, display: "flex", alignItems: "center",
                        opacity: 0.4, transition: "opacity 150ms",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                      onMouseLeave={e => (e.currentTarget.style.opacity = "0.4")}
                      title="Edit & resend"
                    >
                      <Pencil size={12} color={C.text.muted} />
                    </button>
                  )}
                  {onRetry && isLast && (
                    <button
                      onClick={onRetry}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        padding: 3, borderRadius: 4, display: "flex", alignItems: "center",
                        opacity: 0.4, transition: "opacity 150ms",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                      onMouseLeave={e => (e.currentTarget.style.opacity = "0.4")}
                      title="Retry"
                    >
                      <RotateCcw size={12} color={C.text.muted} />
                    </button>
                  )}
                </div>
              )}

              {/* Retry button on assistant error messages */}
              {!isUser && m.content.startsWith("Error:") && !loading && onRetry && (
                <button
                  onClick={onRetry}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    background: "var(--c-bg-surface)", border: "1px solid var(--c-border)",
                    borderRadius: 6, padding: "4px 10px", fontSize: 11,
                    color: C.accent.primary, cursor: "pointer",
                    transition: "all 150ms",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent.primary; e.currentTarget.style.background = `${C.accent.primary}11`; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--c-border)"; e.currentTarget.style.background = "var(--c-bg-surface)"; }}
                >
                  <RotateCcw size={12} />
                  Retry
                </button>
              )}

              {/* Feedback bar — thumbs up/down on assistant messages */}
              {!isUser && m.content && !(loading && isLast) && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  paddingLeft: 4, paddingTop: 2,
                }}>
                  <button
                    onClick={() => handleFeedback(i, m.content, "up")}
                    disabled={!!ratings[i]}
                    style={{
                      background: "none", border: "none", cursor: ratings[i] ? "default" : "pointer",
                      padding: 4, borderRadius: 4, display: "flex", alignItems: "center",
                      opacity: ratings[i] === "down" ? 0.3 : ratings[i] === "up" ? 1 : 0.5,
                      transition: "opacity 150ms",
                    }}
                    aria-label="Thumbs up"
                  >
                    <ThumbsUp
                      size={13}
                      color={ratings[i] === "up" ? C.accent.primary : C.text.faint}
                      fill={ratings[i] === "up" ? C.accent.primary : "none"}
                      strokeWidth={1.8}
                    />
                  </button>
                  <button
                    onClick={() => handleFeedback(i, m.content, "down")}
                    disabled={!!ratings[i]}
                    style={{
                      background: "none", border: "none", cursor: ratings[i] ? "default" : "pointer",
                      padding: 4, borderRadius: 4, display: "flex", alignItems: "center",
                      opacity: ratings[i] === "up" ? 0.3 : ratings[i] === "down" ? 1 : 0.5,
                      transition: "opacity 150ms",
                    }}
                    aria-label="Thumbs down"
                  >
                    <ThumbsDown
                      size={13}
                      color={ratings[i] === "down" ? C.status.danger : C.text.faint}
                      fill={ratings[i] === "down" ? C.status.danger : "none"}
                      strokeWidth={1.8}
                    />
                  </button>
                </div>
              )}

              {/* Tool calls — expandable blocks */}
              {m.tools && m.tools.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: "82%" }}>
                  {m.tools.map((tool, ti) => <ToolCallBlock key={ti} tool={tool} />)}
                </div>
              )}
              {/* Backward compat — old cmds without tool data */}
              {(!m.tools || m.tools.length === 0) && m.cmds && m.cmds.length > 0 && (
                <div style={{
                  background: "var(--c-bg-panel)", border: "1px solid var(--c-border)",
                  borderRadius: 6, padding: "6px 10px",
                  fontSize: 11, fontFamily: "'Cascadia Code','Consolas',monospace",
                  color: C.status.success, maxWidth: "82%",
                }}>
                  {m.cmds.map((c, ci) => <div key={ci}>$ {c}</div>)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Input bar */}
      <div style={{
        padding: "12px 16px 16px",
        borderTop: "1px solid var(--c-border)",
        background: "var(--c-bg-panel)",
        flexShrink: 0,
      }}>
        <div style={{
          display: "flex", gap: 10, alignItems: "flex-end",
          background: "var(--c-bg-surface)",
          border: `1px solid ${focused ? "var(--c-accent)" : "var(--c-border)"}`,
          borderRadius: 10, padding: "10px 12px",
          transition: "border-color .15s",
        }}>
          <textarea
            ref={inputRef}
            aria-label="Chat message"
            rows={1}
            value={text}
            onChange={onInput}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder ?? "Ask anything… (Enter to send, Shift+Enter for new line)"}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "var(--c-text-primary)", fontSize: 13, resize: "none",
              fontFamily: "inherit", lineHeight: 1.5,
              minHeight: 20, maxHeight: 120,
            }}
          />
          <button
            onClick={submit}
            aria-label={loading ? "Sending message" : "Send message"}
            disabled={loading || !text.trim()}
            style={{
              background: loading || !text.trim() ? "var(--c-border)" : "var(--c-accent)",
              border: "none", borderRadius: 7,
              width: 32, height: 32, flexShrink: 0,
              color: "#fff", fontWeight: 700,
              cursor: loading || !text.trim() ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background .15s",
            }}
          >
            {loading ? (
              <span style={{ width: 13, height: 13, border: "2px solid var(--c-accent-dim)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
              </svg>
            )}
          </button>
        </div>
        <div style={{ fontSize: 10, color: C.text.dim, marginTop: 6, textAlign: "center" }}>
          Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}

function ToolCallBlock({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = tool.status === "running"
    ? <span style={{ width: 12, height: 12, border: `2px solid ${C.accent.light}44`, borderTopColor: C.accent.light, borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />
    : tool.status === "error"
    ? <XIcon size={12} color={C.status.danger} />
    : <Check size={12} color={C.status.success} />;

  const durationStr = tool.duration != null ? `${(tool.duration / 1000).toFixed(1)}s` : "";

  return (
    <div style={{
      background: C.bg.panel,
      border: `1px solid ${tool.status === "error" ? C.status.danger + "44" : C.border.subtle}`,
      borderRadius: 6,
      overflow: "hidden",
      ...(tool.status === "running" ? { animation: "glow-pulse 2s infinite" } : {}),
    }}>
      <div
        onClick={() => tool.output && setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 10px",
          cursor: tool.output ? "pointer" : "default",
          fontSize: 11,
          fontFamily: "'Cascadia Code','Consolas',monospace",
        }}
      >
        {tool.output && (
          expanded
            ? <ChevronDown size={12} color={C.text.muted} />
            : <ChevronRight size={12} color={C.text.muted} />
        )}
        <span style={{ color: C.text.muted }}>$</span>
        <span style={{ color: C.status.success, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tool.cmd}</span>
        {durationStr && <span style={{ color: C.text.faint, fontSize: 10, flexShrink: 0 }}>{durationStr}</span>}
        <span style={{ flexShrink: 0 }}>{statusIcon}</span>
      </div>
      {expanded && tool.output && (
        <div style={{
          borderTop: `1px solid ${C.border.subtle}`,
          padding: "8px 10px",
          fontSize: 11,
          fontFamily: "'Cascadia Code','Consolas',monospace",
          color: C.text.secondary,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          maxHeight: 200,
          overflowY: "auto",
        }}>
          {tool.output}
        </div>
      )}
    </div>
  );
}

function ThinkingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", height: 16 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: "50%",
          background: C.accent.light, display: "inline-block",
          animation: `bounce 1.2s ${i * 0.2}s infinite`,
        }} />
      ))}
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-5px);opacity:1}}`}</style>
    </span>
  );
}
