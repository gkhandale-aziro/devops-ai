import { useState, useRef, useEffect } from "react";
import { Check, X as XIcon, ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, RotateCcw, Pencil } from "lucide-react";
import type { ChatMsg, ToolCall } from "../hooks/useChat";
import { Markdown } from "./Markdown";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT } from "../utils/theme";
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
      <div
        ref={feedRef}
        role="log"
        aria-live="polite"
        aria-busy={loading}
        aria-label="Chat messages"
        style={{ flex: 1, overflowY: "auto", padding: `${SPACE.xl}px ${SPACE.xxl}px`, display: "flex", flexDirection: "column", gap: SPACE.lg }}
      >
        {visibleMessages.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 14, color: C.text.muted, paddingTop: 40 }}>
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
              <div style={{ fontSize: FONT_SIZE.md, color: C.text.secondary, fontWeight: FONT_WEIGHT.semibold, marginBottom: SPACE.xs }}>AI Assistant</div>
              <div style={{ fontSize: FONT_SIZE.sm, lineHeight: 1.6 }}>
                {placeholder ?? "Ask anything about this target…"}
              </div>
            </div>
          </div>
        )}

        {visibleMessages.map((m, i) => {
          const isUser = m.role === "user";
          const isLast = i === visibleMessages.length - 1;

          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", gap: SPACE.xs, animation: "fadeIn .2s ease-out" }}>
              {/* Role label */}
              <div style={{ fontSize: FONT_SIZE.xs, color: C.text.faint, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: FONT_WEIGHT.semibold, paddingLeft: isUser ? 0 : SPACE.xs }}>
                {isUser ? "You" : "Aziro AI"}
              </div>

              {/* Bubble */}
              <div style={{
                maxWidth: "82%",
                background: isUser ? `linear-gradient(135deg,${C.accent.primary},${C.accent.light})` : C.bg.elevated,
                border: isUser ? "none" : `1px solid ${C.border.muted}`,
                borderRadius: isUser ? `${RADIUS.xl}px ${RADIUS.xl}px ${SPACE.xxs}px ${RADIUS.xl}px` : `${RADIUS.xl}px ${RADIUS.xl}px ${RADIUS.xl}px ${SPACE.xxs}px`,
                padding: `${SPACE.md}px 14px`,
                fontSize: FONT_SIZE.md,
                lineHeight: 1.65,
                color: "var(--c-text-primary)",
                position: "relative",
              }}>
                {isUser && editingIdx === i ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: RADIUS.md }}>
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
                        borderRadius: RADIUS.md, padding: `${RADIUS.md}px ${SPACE.sm}px`, color: "var(--c-text-on-accent, #fff)",
                        fontSize: FONT_SIZE.md, fontFamily: "inherit", resize: "none",
                        outline: "none", minHeight: 36, lineHeight: 1.5,
                      }}
                      rows={2}
                    />
                    <div style={{ display: "flex", gap: RADIUS.md, justifyContent: "flex-end" }}>
                      <button onClick={() => setEditingIdx(null)} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "var(--c-text-on-accent, #fff)", borderRadius: RADIUS.sm, padding: `3px ${SPACE.md}px`, fontSize: FONT_SIZE.sm, cursor: "pointer" }}>Cancel</button>
                      <button onClick={() => { if (editText.trim() && onEdit) { onEdit(i, editText.trim()); setEditingIdx(null); } }} style={{ background: "var(--c-text-on-accent, #fff)", border: "none", color: C.accent.primary, borderRadius: RADIUS.sm, padding: `3px ${SPACE.md}px`, fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold, cursor: "pointer" }}>Send</button>
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
                <div style={{ display: "flex", gap: SPACE.xs, alignItems: "center" }}>
                  {onEdit && (
                    <button
                      onClick={() => { setEditingIdx(i); setEditText(m.content); }}
                      className="hover-opacity-full"
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        padding: 3, borderRadius: RADIUS.sm, display: "flex", alignItems: "center",
                        opacity: 0.4, transition: "opacity 150ms",
                      }}
                      title="Edit & resend"
                    >
                      <Pencil size={12} color={C.text.muted} />
                    </button>
                  )}
                  {onRetry && isLast && (
                    <button
                      onClick={onRetry}
                      className="hover-opacity-full"
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        padding: 3, borderRadius: RADIUS.sm, display: "flex", alignItems: "center",
                        opacity: 0.4, transition: "opacity 150ms",
                      }}
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
                  className="hover-border-accent hover-bg-accent-dim"
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    background: C.bg.elevated, border: `1px solid ${C.border.muted}`,
                    borderRadius: RADIUS.md, padding: `${SPACE.xs}px ${SPACE.md}px`, fontSize: FONT_SIZE.sm,
                    color: C.accent.primary, cursor: "pointer",
                    transition: "all 150ms",
                  }}
                >
                  <RotateCcw size={12} />
                  Retry
                </button>
              )}

              {/* Feedback bar — thumbs up/down on assistant messages */}
              {!isUser && m.content && !(loading && isLast) && (
                <div style={{
                  display: "flex", alignItems: "center", gap: RADIUS.md,
                  paddingLeft: SPACE.xs, paddingTop: SPACE.xxs,
                }}>
                  <button
                    onClick={() => handleFeedback(i, m.content, "up")}
                    disabled={!!ratings[i]}
                    style={{
                      background: "none", border: "none", cursor: ratings[i] ? "default" : "pointer",
                      padding: SPACE.xs, borderRadius: RADIUS.sm, display: "flex", alignItems: "center",
                      opacity: ratings[i] === "down" ? 0.3 : ratings[i] === "up" ? 1 : 0.5,
                      transition: "opacity 150ms",
                    }}
                    aria-label="Thumbs up"
                  >
                    <ThumbsUp
                      size={FONT_SIZE.md}
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
                      padding: SPACE.xs, borderRadius: RADIUS.sm, display: "flex", alignItems: "center",
                      opacity: ratings[i] === "up" ? 0.3 : ratings[i] === "down" ? 1 : 0.5,
                      transition: "opacity 150ms",
                    }}
                    aria-label="Thumbs down"
                  >
                    <ThumbsDown
                      size={FONT_SIZE.md}
                      color={ratings[i] === "down" ? C.status.danger : C.text.faint}
                      fill={ratings[i] === "down" ? C.status.danger : "none"}
                      strokeWidth={1.8}
                    />
                  </button>
                </div>
              )}

              {/* Follow-up suggestion chips — only on the most recent assistant message */}
              {!isUser && isLast && !loading && m.suggestions && m.suggestions.length > 0 && (
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: RADIUS.md,
                  paddingLeft: SPACE.xs, paddingTop: RADIUS.md, maxWidth: "82%",
                }}>
                  {m.suggestions.map((s, si) => (
                    <button
                      key={si}
                      onClick={() => onSend(s)}
                      className="hover-bg-accent-dim hover-border-accent"
                      style={{
                        background: C.bg.elevated,
                        border: `1px solid ${C.accent.primary}55`,
                        color: C.accent.light,
                        borderRadius: RADIUS.pill,
                        padding: `${SPACE.xs}px ${SPACE.md}px`,
                        fontSize: FONT_SIZE.sm,
                        cursor: "pointer",
                        transition: "all 150ms",
                        fontFamily: "inherit",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {/* Tool calls — expandable blocks */}
              {m.tools && m.tools.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: SPACE.xs, maxWidth: "82%" }}>
                  {m.tools.map((tool, ti) => <ToolCallBlock key={ti} tool={tool} />)}
                </div>
              )}
              {/* Backward compat — old cmds without tool data */}
              {(!m.tools || m.tools.length === 0) && m.cmds && m.cmds.length > 0 && (
                <div style={{
                  background: C.bg.panel, border: `1px solid ${C.border.muted}`,
                  borderRadius: RADIUS.md, padding: `${RADIUS.md}px ${SPACE.md}px`,
                  fontSize: FONT_SIZE.sm, fontFamily: "'Cascadia Code','Consolas',monospace",
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
        padding: `${SPACE.md}px ${SPACE.lg}px ${SPACE.lg}px`,
        borderTop: `1px solid ${C.border.muted}`,
        background: C.bg.panel,
        flexShrink: 0,
      }}>
        <div style={{
          display: "flex", gap: SPACE.md, alignItems: "flex-end",
          background: C.bg.elevated,
          border: `1px solid ${focused ? "var(--c-accent)" : C.border.muted}`,
          borderRadius: SPACE.md, padding: `${SPACE.md}px ${SPACE.md}px`,
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
              color: C.text.primary, fontSize: FONT_SIZE.md, resize: "none",
              fontFamily: "inherit", lineHeight: 1.5,
              minHeight: 20, maxHeight: 120,
            }}
          />
          <button
            onClick={submit}
            aria-label={loading ? "Sending message" : "Send message"}
            disabled={loading || !text.trim()}
            style={{
              background: loading || !text.trim() ? C.border.muted : "var(--c-accent)",
              border: "none", borderRadius: RADIUS.lg,
              width: 32, height: 32, flexShrink: 0,
              color: "var(--c-text-on-accent, #fff)", fontWeight: FONT_WEIGHT.bold,
              cursor: loading || !text.trim() ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background .15s",
            }}
          >
            {loading ? (
              <span style={{ width: FONT_SIZE.md, height: FONT_SIZE.md, border: "2px solid var(--c-accent-dim)", borderTopColor: "var(--c-text-on-accent, #fff)", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
              </svg>
            )}
          </button>
        </div>
        <div style={{ fontSize: FONT_SIZE.xs, color: C.text.dim, marginTop: RADIUS.md, textAlign: "center" }}>
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
      borderRadius: RADIUS.md,
      overflow: "hidden",
      ...(tool.status === "running" ? { animation: "glow-pulse 2s infinite" } : {}),
    }}>
      <button
        type="button"
        onClick={() => tool.output && setExpanded(!expanded)}
        disabled={!tool.output}
        aria-expanded={tool.output ? expanded : undefined}
        aria-label={tool.output ? `${expanded ? "Collapse" : "Expand"} output for ${tool.cmd}` : tool.cmd}
        style={{
          display: "flex", alignItems: "center", gap: SPACE.sm,
          padding: `${RADIUS.md}px ${SPACE.md}px`,
          cursor: tool.output ? "pointer" : "default",
          fontSize: FONT_SIZE.sm,
          fontFamily: "'Cascadia Code','Consolas',monospace",
          // Neutralize default button chrome — the row renders as a strip, not a button.
          width: "100%",
          background: "transparent",
          border: "none",
          color: "inherit",
          textAlign: "left",
        }}
      >
        {tool.output && (
          expanded
            ? <ChevronDown size={12} color={C.text.muted} />
            : <ChevronRight size={12} color={C.text.muted} />
        )}
        <span style={{ color: C.text.muted }}>$</span>
        <span style={{ color: C.status.success, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tool.cmd}</span>
        {durationStr && <span style={{ color: C.text.faint, fontSize: FONT_SIZE.xs, flexShrink: 0 }}>{durationStr}</span>}
        <span style={{ flexShrink: 0 }}>{statusIcon}</span>
      </button>
      {expanded && tool.output && (
        <div style={{
          borderTop: `1px solid ${C.border.subtle}`,
          padding: `${SPACE.sm}px ${SPACE.md}px`,
          fontSize: FONT_SIZE.sm,
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
    <span style={{ display: "inline-flex", gap: SPACE.xs, alignItems: "center", height: SPACE.lg }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: RADIUS.md, height: RADIUS.md, borderRadius: "50%",
          background: C.accent.light, display: "inline-block",
          animation: `bounce 1.2s ${i * 0.2}s infinite`,
        }} />
      ))}
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-5px);opacity:1}}`}</style>
    </span>
  );
}
