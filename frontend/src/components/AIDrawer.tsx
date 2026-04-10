import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { api, readSSE } from "../api/client";
import { Markdown } from "./Markdown";

interface Props {
  open:    boolean;
  context: string;
  title:   string;
  onClose: () => void;
}

export function AIDrawer({ open, context, title, onClose }: Props) {
  const [text,     setText]     = useState("");
  const [loading,  setLoading]  = useState(false);
  const [question, setQuestion] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  // Auto-run analysis when opened
  useEffect(() => {
    if (!open || !context) return;
    setText("");
    setLoading(true);
    let cancelled = false;

    (async () => {
      try {
        const res = await api.analyzeStream(context);
        let full = "";
        for await (const evt of readSSE(res)) {
          if (cancelled) break;
          if (typeof evt.t === "string") { full += evt.t; setText(full); }
        }
      } catch {
        if (!cancelled) setText("Failed to get AI analysis. Check your AI model config.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, context]);

  // Auto-scroll as text streams in
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = panelRef.current.scrollHeight;
  }, [text]);

  async function askFollowUp() {
    const q = question.trim();
    if (!q || loading) return;
    setQuestion("");
    setLoading(true);
    const prompt = `${context}\n\nPrevious analysis:\n${text}\n\nFollow-up: ${q}`;
    try {
      const res = await api.analyzeStream(prompt);
      let full  = text + `\n\n---\n\n**Q: ${q}**\n\n`;
      setText(full);
      for await (const evt of readSSE(res)) {
        if (typeof evt.t === "string") { full += evt.t; setText(full); }
      }
    } catch {
      setText(prev => prev + "\n\nFailed to get response.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "#00000055", zIndex: 140 }}
      />

      {/* Drawer panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 520,
        background: "#0f1219",
        borderLeft: "1px solid #1e2235",
        zIndex: 150,
        display: "flex", flexDirection: "column",
        boxShadow: "-12px 0 40px #00000066",
        animation: "slideIn .2s ease-out",
      }}>

        {/* Header */}
        <div style={{
          padding: "14px 18px",
          borderBottom: "1px solid #1e2235",
          display: "flex", alignItems: "center", gap: 10,
          flexShrink: 0,
          background: "linear-gradient(180deg, #161b27 0%, #0f1219 100%)",
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: "#6366f118", border: "1px solid #6366f133",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/>
              <path d="M12 16v-4"/><path d="M12 8h.01"/>
            </svg>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#6366f1", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>AI Analysis</div>
            <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          </div>

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#6366f1", animation: "pulse 1s infinite", display: "inline-block" }} />
              <span style={{ fontSize: 11, color: "#818cf8" }}>Analyzing…</span>
            </div>
          )}

          <button
            onClick={onClose}
            style={{
              background: "#1e2235", border: "1px solid #2d3555",
              borderRadius: 6, color: "#94a3b8",
              width: 28, height: 28, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, flexShrink: 0,
            }}
          ><X size={16} /></button>
        </div>

        {/* Content area */}
        <div
          ref={panelRef}
          style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}
        >
          {text ? (
            <Markdown>{text}</Markdown>
          ) : loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
              {[90, 75, 95, 60, 80].map((w, i) => (
                <div key={i} style={{ height: 13, width: `${w}%`, background: "#1e2235", borderRadius: 4, animation: "shimmer 1.4s infinite" }} />
              ))}
            </div>
          ) : (
            <div style={{ color: "#475569", fontSize: 13, textAlign: "center", paddingTop: 40 }}>—</div>
          )}
        </div>

        {/* Follow-up input */}
        <div style={{
          padding: "12px 16px 16px",
          borderTop: "1px solid #1e2235",
          flexShrink: 0,
          background: "#0b0d14",
        }}>
          <div style={{ fontSize: 10, color: "#475569", marginBottom: 7, textTransform: "uppercase", letterSpacing: ".5px" }}>
            Ask a follow-up
          </div>
          <div style={{
            display: "flex", gap: 8,
            background: "#161b27",
            border: "1px solid #2d3555",
            borderRadius: 8, padding: "8px 12px",
            transition: "border-color .15s",
          }}
            onFocusCapture={e => (e.currentTarget.style.borderColor = "#6366f1")}
            onBlurCapture={e => (e.currentTarget.style.borderColor = "#2d3555")}
          >
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); askFollowUp(); } }}
              placeholder="Ask about root cause, fix, or any follow-up…"
              disabled={loading}
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: "#e2e8f0", fontSize: 13, fontFamily: "inherit",
              }}
            />
            <button
              onClick={askFollowUp}
              disabled={loading || !question.trim()}
              style={{
                background: loading || !question.trim() ? "#1e2235" : "#6366f1",
                border: "none", borderRadius: 6,
                width: 30, height: 30,
                color: "#fff", fontWeight: 700, fontSize: 16,
                cursor: loading || !question.trim() ? "default" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background .15s",
                flexShrink: 0,
              }}
            >
              {loading ? (
                <span style={{ width: 12, height: 12, border: "2px solid #6366f133", borderTopColor: "#6366f1", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />
              ) : "↑"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
