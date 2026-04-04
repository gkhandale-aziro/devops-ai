import { useState, useRef, useEffect } from "react";
import { api, readSSE } from "../api/client";

interface Props {
  open: boolean;
  context: string;
  title: string;
  onClose: () => void;
}

export function AIDrawer({ open, context, title, onClose }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && context) {
      setText("");
      setLoading(true);
      let cancelled = false;

      (async () => {
        try {
          const res = await api.analyzeStream(context);
          let full = "";
          for await (const evt of readSSE(res)) {
            if (cancelled) break;
            if (typeof evt.t === "string") {
              full += evt.t;
              setText(full);
            }
          }
        } catch {
          if (!cancelled) setText("Failed to get AI analysis. Check your AI model config.");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => { cancelled = true; };
    }
  }, [open, context]);

  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.scrollTop = panelRef.current.scrollHeight;
    }
  }, [text]);

  async function askFollowUp() {
    const q = question.trim();
    if (!q || loading) return;
    setQuestion("");
    setLoading(true);
    const followUpPrompt = `${context}\n\nPrevious AI analysis:\n${text}\n\nUser follow-up question: ${q}`;
    try {
      const res = await api.analyzeStream(followUpPrompt);
      let full = text + `\n\n---\n\n**Q: ${q}**\n\n`;
      setText(full);
      for await (const evt of readSSE(res)) {
        if (typeof evt.t === "string") {
          full += evt.t;
          setText(full);
        }
      }
    } catch {
      setText((prev: string) => prev + "\n\nFailed to get response.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div style={{
      position: "fixed",
      top: 0,
      right: 0,
      bottom: 0,
      width: 480,
      background: "#13161f",
      borderLeft: "1px solid #2d3148",
      zIndex: 150,
      display: "flex",
      flexDirection: "column",
      boxShadow: "-8px 0 32px #00000044",
      animation: "slideIn .2s ease-out",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 18px",
        borderBottom: "1px solid #2d3148",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexShrink: 0,
        background: "#0f1219",
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c8cf8" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <strong style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </strong>
        {loading && (
          <span style={{ fontSize: 11, color: "#7c8cf8", animation: "pulse 1.5s infinite" }}>analyzing…</span>
        )}
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "0 2px" }}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div ref={panelRef} style={{
        flex: 1,
        overflowY: "auto",
        padding: 18,
        fontSize: 13,
        lineHeight: 1.75,
        color: "#cbd5e1",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>
        {text || (loading ? "Analyzing…" : "—")}
      </div>

      {/* Follow-up input */}
      <div style={{ padding: "10px 16px", borderTop: "1px solid #2d3148", flexShrink: 0 }}>
        <div style={{
          display: "flex",
          gap: 8,
          background: "#0d1117",
          border: "1px solid #2d3148",
          borderRadius: 8,
          padding: "8px 12px",
        }}>
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); askFollowUp(); } }}
            placeholder="Ask a follow-up question…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#e2e8f0",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={askFollowUp}
            disabled={loading || !question.trim()}
            style={{
              background: loading ? "#374151" : "#4f46e5",
              border: "none",
              borderRadius: 6,
              padding: "4px 14px",
              color: "#fff",
              fontWeight: 600,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "…" : "↑"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
      `}</style>
    </div>
  );
}
