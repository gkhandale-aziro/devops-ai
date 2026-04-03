import { useState, useRef, useEffect } from "react";
import type { ChatMsg } from "../hooks/useChat";

interface Props {
  messages: ChatMsg[];
  loading:  boolean;
  onSend:   (text: string) => void;
  placeholder?: string;
}

export function ChatPanel({ messages, loading, onSend, placeholder }: Props) {
  const [text, setText] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current)
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages]);

  function submit() {
    const t = text.trim();
    if (!t || loading) return;
    setText("");
    onSend(t);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* messages */}
      <div ref={feedRef} style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", marginTop: 40 }}>
            Ask me anything about this target…
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
            {m.cmds && m.cmds.length > 0 && (
              <div style={{ background: "#0d1117", border: "1px solid #2d3148", borderRadius: 6, padding: "6px 10px", marginBottom: 6, fontSize: 11, fontFamily: "monospace", color: "#64748b" }}>
                {m.cmds.map((c, ci) => <div key={ci}>$ {c}</div>)}
              </div>
            )}
            <div
              style={{
                background:   m.role === "user" ? "#4f46e5" : "#1a1d27",
                border:       m.role === "user" ? "none" : "1px solid #2d3148",
                borderRadius: m.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
                padding:      "10px 14px",
                fontSize:     13,
                lineHeight:   1.6,
                color:        "#e2e8f0",
                whiteSpace:   "pre-wrap",
                wordBreak:    "break-word",
              }}
            >
              {m.content || (loading && i === messages.length - 1
                ? <ThinkingDots />
                : "—")}
            </div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 3, textAlign: m.role === "user" ? "right" : "left" }}>
              {m.role === "user" ? "You" : "AI"}
            </div>
          </div>
        ))}
      </div>

      {/* input */}
      <div style={{ padding: "10px 16px", borderTop: "1px solid #2d3148", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, background: "#0d1117", border: "1px solid #2d3148", borderRadius: 8, padding: "8px 12px", transition: "border-color .15s" }}>
          <textarea
            rows={1}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={placeholder ?? "Ask anything…"}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#e2e8f0", fontSize: 13, resize: "none", fontFamily: "inherit" }}
          />
          <button
            onClick={submit}
            disabled={loading || !text.trim()}
            style={{ background: loading ? "#374151" : "#4f46e5", border: "none", borderRadius: 6, padding: "4px 14px", color: "#fff", fontWeight: 600, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "…" : "↑"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: 5, height: 5, borderRadius: "50%", background: "#94a3b8", display: "inline-block",
            animation: `bounce 1.2s ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-4px);opacity:1}}`}</style>
    </span>
  );
}
