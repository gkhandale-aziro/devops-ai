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
  const drawerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // a11y: remember origin focus on open, restore on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    drawerRef.current?.focus();
    return () => { previouslyFocusedRef.current?.focus?.(); };
  }, [open]);

  // a11y: Escape closes; Tab trapped inside the drawer.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !drawerRef.current) return;
      const focusables = drawerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Auto-run analysis when opened
  useEffect(() => {
    if (!open || !context) return;
    setText("");
    setLoading(true);
    const abort = new AbortController();

    (async () => {
      try {
        const res = await api.analyzeStream(context, abort.signal);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        let full = "";
        for await (const evt of readSSE(res)) {
          if (abort.signal.aborted) break;
          if (typeof evt.error === "string") { setText(`Error: ${evt.error}`); return; }
          if (typeof evt.t === "string") { full += evt.t; setText(full); }
        }
      } catch (e) {
        if (abort.signal.aborted) return;
        const msg = String((e as Error)?.message ?? e);
        if (msg.includes("timeout") || msg.includes("Timeout")) {
          setText("AI analysis timed out. The model may be overloaded — try again.");
        } else {
          setText("Failed to get AI analysis. Check your AI model config.");
        }
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();

    return () => { abort.abort(); };
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
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      let full  = text + `\n\n---\n\n**Q: ${q}**\n\n`;
      setText(full);
      for await (const evt of readSSE(res)) {
        if (typeof evt.error === "string") { setText(prev => prev + `\n\nError: ${evt.error}`); return; }
        if (typeof evt.t === "string") { full += evt.t; setText(full); }
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (msg.includes("timeout") || msg.includes("Timeout")) {
        setText(prev => prev + "\n\nRequest timed out. Try again.");
      } else {
        setText(prev => prev + "\n\nFailed to get response.");
      }
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
      <div
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`AI analysis — ${title}`}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 520,
          background: "var(--c-bg-raised)",
          borderLeft: "1px solid var(--c-bg-active)",
          zIndex: 150,
          display: "flex", flexDirection: "column",
          boxShadow: "-12px 0 40px #00000066",
          animation: "slideIn .2s ease-out",
          outline: "none",
        }}
      >

        {/* Header */}
        <div style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--c-bg-active)",
          display: "flex", alignItems: "center", gap: 10,
          flexShrink: 0,
          background: "linear-gradient(180deg, var(--c-bg-surface) 0%, var(--c-bg-raised) 100%)",
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: "color-mix(in srgb, var(--c-accent) 9%, transparent)", border: "1px solid color-mix(in srgb, var(--c-accent) 20%, transparent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/>
              <path d="M12 16v-4"/><path d="M12 8h.01"/>
            </svg>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--c-accent)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>AI Analysis</div>
            <div style={{ fontSize: 12, color: "var(--c-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          </div>

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--c-accent)", animation: "pulse 1s infinite", display: "inline-block" }} />
              <span style={{ fontSize: 11, color: "#818cf8" }}>Analyzing…</span>
            </div>
          )}

          <button
            onClick={onClose}
            aria-label="Close AI analysis"
            style={{
              background: "var(--c-bg-active)", border: "1px solid var(--c-border)",
              borderRadius: 6, color: "var(--c-text-secondary)",
              width: 28, height: 28, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, flexShrink: 0,
            }}
          ><X size={16} /></button>
        </div>

        {/* Content area */}
        <div
          ref={panelRef}
          aria-live="polite"
          aria-busy={loading}
          style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}
        >
          {text ? (
            <Markdown>{text}</Markdown>
          ) : loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
              {[90, 75, 95, 60, 80].map((w, i) => (
                <div key={i} style={{ height: 13, width: `${w}%`, background: "var(--c-bg-active)", borderRadius: 4, animation: "shimmer 1.4s infinite" }} />
              ))}
            </div>
          ) : (
            <div style={{ color: "var(--c-text-muted)", fontSize: 13, textAlign: "center", paddingTop: 40 }}>—</div>
          )}
        </div>

        {/* Follow-up input */}
        <div style={{
          padding: "12px 16px 16px",
          borderTop: "1px solid var(--c-bg-active)",
          flexShrink: 0,
          background: "var(--c-bg-raised)",
        }}>
          <label htmlFor="aidrawer-followup" style={{ display: "block", fontSize: 10, color: "var(--c-text-muted)", marginBottom: 7, textTransform: "uppercase", letterSpacing: ".5px" }}>
            Ask a follow-up
          </label>
          <div style={{
            display: "flex", gap: 8,
            background: "var(--c-bg-surface)",
            border: "1px solid var(--c-border)",
            borderRadius: 8, padding: "8px 12px",
            transition: "border-color .15s",
          }}
            onFocusCapture={e => (e.currentTarget.style.borderColor = "var(--c-accent)")}
            onBlurCapture={e => (e.currentTarget.style.borderColor = "var(--c-border)")}
          >
            <input
              id="aidrawer-followup"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); askFollowUp(); } }}
              placeholder="Ask about root cause, fix, or any follow-up…"
              disabled={loading}
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: "var(--c-text-primary)", fontSize: 13, fontFamily: "inherit",
              }}
            />
            <button
              onClick={askFollowUp}
              disabled={loading || !question.trim()}
              aria-label={loading ? "Sending" : "Send follow-up question"}
              style={{
                background: loading || !question.trim() ? "var(--c-bg-active)" : "var(--c-accent)",
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
                <span style={{ width: 12, height: 12, border: "2px solid color-mix(in srgb, var(--c-accent) 20%, transparent)", borderTopColor: "var(--c-accent)", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />
              ) : "↑"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
