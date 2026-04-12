/**
 * LogStream.tsx — Live log streaming panel (P4).
 * Connects to /api/logs/<tid>/stream SSE and tails output in real time.
 * Displayed as a bottom tray in Dashboard, inspired by Lens.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause } from "lucide-react";
import type { Target } from "../types";
import { api } from "../api/client";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT } from "../utils/theme";

const MAX_RETRIES  = 5;
const BASE_DELAY_MS = 1500;

interface Props {
  target: Target;
  pod:    string;
  namespace: string;
  container?: string;
  onClose: () => void;
}

const MAX_LINES = 500;

// Hoisted outside component — avoids recreation on every render (js-hoist-regexp)
const ERROR_RE = /error|fatal/i;
const WARN_RE  = /warn/i;

function highlightLine(line: string): string {
  if (ERROR_RE.test(line)) return C.status.danger;
  if (WARN_RE.test(line))  return C.status.warning;
  return C.text.muted;
}

export function LogStream({ target, pod, namespace, container, onClose }: Props) {
  const [lines, setLines]         = useState<string[]>([]);
  const [paused, setPaused]       = useState(false);
  const [search, setSearch]       = useState("");
  const [connected, setConnected] = useState(false);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const esRef      = useRef<EventSource | null>(null);
  const pausedRef  = useRef(false);
  const retryRef   = useRef(0);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  pausedRef.current = paused;

  const connect = useCallback(() => {
    esRef.current?.close();
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setLines([]);
    setConnected(false);

    const url = api.logStreamUrl(target.id, pod, namespace, container);
    const es = new EventSource(url);

    es.onopen = () => { setConnected(true); retryRef.current = 0; };

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.line !== undefined) {
          setLines(prev => {
            const next = [...prev, data.line];
            return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
          });
        }
        if (data.error) {
          setLines(prev => [...prev, `[ERROR] ${data.error}`]);
        }
      } catch { /* skip */ }
    };

    es.onerror = () => {
      es.close();
      setConnected(false);
      if (retryRef.current >= MAX_RETRIES) return;
      const delay = BASE_DELAY_MS * Math.pow(2, retryRef.current);
      retryRef.current += 1;
      timerRef.current = setTimeout(() => {
        const next = new EventSource(api.logStreamUrl(target.id, pod, namespace, container));
        esRef.current = next;
        next.onopen    = es.onopen;
        next.onmessage = es.onmessage;
        next.onerror   = es.onerror;
      }, delay);
    };

    esRef.current = es;
  }, [target.id, pod, namespace, container]);

  useEffect(() => {
    connect();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      esRef.current?.close();
    };
  }, [connect]);

  // Auto-scroll when not paused
  useEffect(() => {
    if (!pausedRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines.length]);

  const filtered = search
    ? lines.filter(l => l.toLowerCase().includes(search.toLowerCase()))
    : lines;

  return (
    <div style={{
      height: 280, flexShrink: 0,
      borderTop: "1px solid var(--c-border)",
      background: "var(--c-bg-panel)",
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        padding: `${SPACE.sm}px ${SPACE.md}px`,
        borderBottom: `1px solid ${C.border.muted}`,
        display: "flex", alignItems: "center", gap: SPACE.sm,
        background: C.bg.elevated,
        flexShrink: 0,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: connected ? C.status.success : C.status.danger,
          boxShadow: connected ? `0 0 6px ${C.status.success}` : "none",
          animation: connected ? "pulse 2s infinite" : "none",
          flexShrink: 0,
        }} />
        <span style={{ fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.bold, color: C.accent.light, textTransform: "uppercase", letterSpacing: ".5px" }}>
          Logs
        </span>
        <span style={{ fontSize: FONT_SIZE.sm, color: C.text.secondary, fontWeight: FONT_WEIGHT.medium }}>
          {pod}
        </span>
        <span style={{ fontSize: FONT_SIZE.sm, color: C.text.muted }}>/ {namespace}</span>
        {container && <span style={{ fontSize: FONT_SIZE.sm, color: C.text.faint }}>({container})</span>}

        <div style={{ flex: 1 }} />

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter…"
          style={{
            width: 160, background: "var(--c-bg-surface)", border: `1px solid ${C.border.strong}`,
            color: C.text.primary, borderRadius: RADIUS.sm, padding: `3px ${SPACE.sm}px`, fontSize: FONT_SIZE.sm,
          }}
        />

        <button
          onClick={() => setPaused(p => !p)}
          title={paused ? "Resume auto-scroll" : "Freeze scroll (logs still stream)"}
          style={{
            background: paused ? `${C.status.warning}22` : "transparent",
            border: `1px solid ${paused ? C.status.warning : C.border.strong}`,
            color: paused ? C.status.warning : C.text.muted,
            borderRadius: RADIUS.sm, padding: `3px ${SPACE.sm}px`, fontSize: FONT_SIZE.xs,
            fontWeight: FONT_WEIGHT.bold, cursor: "pointer",
          }}
        >
          {paused ? <><Play size={10} style={{ marginRight: 4 }} /> Resume scroll</> : <><Pause size={10} style={{ marginRight: 4 }} /> Scroll lock</>}
        </button>

        <button
          onClick={() => { setLines([]); }}
          title="Clear"
          style={{
            background: "transparent", border: `1px solid ${C.border.strong}`,
            color: C.text.muted, borderRadius: RADIUS.sm, padding: `3px ${SPACE.sm}px`,
            fontSize: FONT_SIZE.xs, cursor: "pointer",
          }}
        >
          Clear
        </button>

        <span style={{ fontSize: FONT_SIZE.xs, color: C.text.faint }}>{lines.length} lines</span>

        <button
          onClick={onClose}
          aria-label="Close log stream"
          style={{ background: "none", border: "none", color: C.text.muted, cursor: "pointer", display: "flex", alignItems: "center", padding: `${SPACE.xxs}px ${SPACE.xs}px` }}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {/* Log content */}
      <div style={{
        flex: 1, overflowY: "auto", padding: `${SPACE.sm}px ${SPACE.md}px`,
        fontFamily: "'Cascadia Code','Consolas',monospace",
        fontSize: FONT_SIZE.sm, lineHeight: 1.7,
      }}>
        {filtered.length === 0 && (
          <div style={{ color: C.text.faint, padding: `${SPACE.xl}px 0`, textAlign: "center" }}>
            {connected ? "Waiting for logs…" : "Connecting…"}
          </div>
        )}
        {filtered.map((line, i) => (
          <div key={i} style={{ color: highlightLine(line), whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
