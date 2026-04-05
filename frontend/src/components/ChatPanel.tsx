import { useState, useRef, useEffect } from "react";
import type { ChatMsg } from "../hooks/useChat";
import { Markdown } from "./Markdown";

interface Props {
  messages:     ChatMsg[];
  loading:      boolean;
  onSend:       (text: string) => void;
  placeholder?: string;
}

export function ChatPanel({ messages, loading, onSend, placeholder }: Props) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages]);

  function submit() {
    const t = text.trim();
    if (!t || loading) return;
    setText("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setError(null);
    setRetrying(false);
    let didRespond = false;
    // Timeout after 30s if no response
    timeoutRef.current && clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (!didRespond) {
        setError("AI did not respond. Please try again.");
        setRetrying(false);
      }
    }, 30000);
    try {
      onSend(t);
      // Listen for new assistant message or error
      // If a new assistant message arrives, clear error
      // If not, error will be set by timeout
    } catch (e: any) {
      setError(e?.message || "Failed to send message.");
      setRetrying(false);
    }
  }

  // Watch for new assistant message to clear error/timeout
  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
      setError(null);
      setRetrying(false);
      timeoutRef.current && clearTimeout(timeoutRef.current);
    }
    // If last message is user and loading is false, show error
    if (messages.length > 0 && messages[messages.length - 1].role === "user" && !loading && !retrying) {
      setError("AI did not respond. Please try again.");
    }
    // eslint-disable-next-line
  }, [messages, loading]);

  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  }

  function handleRetry() {
    setRetrying(true);
    setError(null);
    submit();
  }

  const visibleMessages = messages;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", flex: 1, overflow: "hidden" }}>
      {/* Messages feed */}
      <div ref={feedRef} style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {visibleMessages.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 14, color: "#64748b", paddingTop: 40 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: "#6366f118", border: "1px solid #6366f133",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="1.8">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>AI Assistant</div>
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
              <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 600, paddingLeft: isUser ? 0 : 4 }}>
                {isUser ? "You" : "Aziro AI"}
              </div>
              {/* Bubble */}
              <div style={{
                maxWidth: "82%",
                background: isUser ? "linear-gradient(135deg,#6366f1,#818cf8)" : "#161b27",
                border: isUser ? "none" : "1px solid #1e2235",
                borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                padding: "10px 14px",
                fontSize: 13,
                lineHeight: 1.65,
                color: "#e2e8f0",
              }}>
                {isUser ? (
                  <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.content}</span>
                ) : m.content ? (
                  <Markdown>{m.content}</Markdown>
                ) : loading && isLast ? (
                  <ThinkingDots />
                ) : "—"}
              </div>
              {/* Commands */}
              {m.cmds && m.cmds.length > 0 && (
                <div style={{
                  background: "#0b0d14", border: "1px solid #1e2235",
                  borderRadius: 6, padding: "6px 10px",
                  fontSize: 11, fontFamily: "'Cascadia Code','Consolas',monospace",
                  color: "#22c55e", maxWidth: "82%",
                }}>
                  {m.cmds.map((c, ci) => <div key={ci}>$ {c}</div>)}
                </div>
              )}
            </div>
          );
        })}
        {error && (
          <div style={{ color: "#fb7185", background: "#2a0011", border: "1px solid #f43f5e", borderRadius: 8, padding: "10px 18px", margin: "8px 0", fontSize: 13, maxWidth: 420 }}>
            {error}
            <button onClick={handleRetry} style={{ marginLeft: 16, background: "#6366f1", color: "#fff", border: "none", borderRadius: 5, padding: "3px 10px", fontSize: 12, cursor: "pointer" }} aria-label="Retry AI message">Retry</button>
          </div>
        )}
      </div>
      {/* Input bar */}
      <div style={{
        padding: "12px 16px 16px",
        borderTop: "1px solid #1e2235",
        background: "#0b0d14",
        flexShrink: 0,
      }}>
        <div style={{
          display: "flex", gap: 10, alignItems: "flex-end",
          background: "#161b27",
          border: `1px solid ${focused ? "#6366f1" : "#1e2235"}`,
          borderRadius: 10, padding: "10px 12px",
          transition: "border-color .15s",
        }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            onChange={onInput}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder ?? "Ask anything… (Enter to send, Shift+Enter for new line)"}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "#e2e8f0", fontSize: 13, resize: "none",
              fontFamily: "inherit", lineHeight: 1.5,
              minHeight: 20, maxHeight: 120,
            }}
            aria-label="Chat input"
          />
          <button
            onClick={submit}
            disabled={loading || !text.trim()}
            style={{
              background: loading || !text.trim() ? "#1e2235" : "#6366f1",
              border: "none", borderRadius: 7,
              width: 32, height: 32, flexShrink: 0,
              color: "#fff", fontWeight: 700,
              cursor: loading || !text.trim() ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background .15s",
            }}
            aria-label="Send message"
          >
            {loading ? (
              <span style={{ width: 13, height: 13, border: "2px solid #6366f133", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
              </svg>
            )}
          </button>
        </div>
        <div style={{ fontSize: 10, color: "#374151", marginTop: 6, textAlign: "center" }}>
          Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", height: 16 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "#818cf8", display: "inline-block",
          animation: `bounce 1.2s ${i * 0.2}s infinite`,
        }} />
      ))}
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-5px);opacity:1}}`}</style>
    </span>
  );
}
