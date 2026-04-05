/**
 * LogStream.tsx — Live log streaming panel (P4).
 * Connects to /api/logs/<tid>/stream SSE and tails output in real time.
 * Displayed as a bottom tray in Dashboard, inspired by Lens.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import type { Target } from "../types";
import { api } from "../api/client";

interface Props {
  target: Target;
  pod:    string;
  namespace: string;
  container?: string;
  onClose: () => void;
}

const MAX_LINES   = 500;
const MAX_RETRIES = 5;
const BASE_DELAY  = 1000;
const MAX_DELAY   = 30_000;

export function LogStream({ target, pod, namespace, container, onClose }: Props) {
  const [lines, setLines]         = useState<string[]>([]);
  const [paused, setPaused]       = useState(false);
  const [search, setSearch]       = useState("");
  const [connected, setConnected] = useState(false);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const esRef      = useRef<EventSource | null>(null);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef   = useRef(0);
  const pausedRef  = useRef(false);
  pausedRef.current = paused;

  const connect = useCallback(() => {
    esRef.current?.close();
    setConnected(false);

    const url = api.logStreamUrl(target.id, pod, namespace, container);
    const es = new EventSource(url);

    es.onopen = () => {
      retryRef.current = 0;
      setConnected(true);
    };

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
      esRef.current = null;
      setConnected(false);
      if (retryRef.current >= MAX_RETRIES) return;
      const delay = Math.min(BASE_DELAY * Math.pow(2, retryRef.current), MAX_DELAY);
      retryRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    };

    esRef.current = es;
  }, [target.id, pod, namespace, container]);

  useEffect(() => {
    retryRef.current = 0;
        <button
          onClick={() => setPaused(p => !p)}
          aria-label={paused ? "Resume log stream" : "Pause log stream"}
          style={{
            background: paused ? "#f59e0b22" : "#22c55e22",
            border: `1px solid ${paused ? "#f59e0b" : "#22c55e"}`,
            color: paused ? "#f59e0b" : "#22c55e",
            borderRadius: 5, padding: "3px 8px", fontSize: 10,
            fontWeight: 700, cursor: "pointer",
          }}
        >
          {paused ? "\u25b6 Resume" : "\u23f8 Pause"}
        </button>

        <button
          onClick={() => { setLines([]); }}
          title="Clear"
          aria-label="Clear log lines"
          style={{
            background: "transparent", border: "1px solid #2d3555",
            color: "#64748b", borderRadius: 5, padding: "3px 8px",
            fontSize: 10, cursor: "pointer",
          }}
        >
          Clear
        </button>

        <span style={{ fontSize: 10, color: "#475569" }}>{lines.length} lines</span>

        <button
          onClick={onClose}
          aria-label="Close log stream"
          style={{
            background: "none", border: "none", color: "#64748b",
            cursor: "pointer", fontSize: 16, lineHeight: 1,
          }}
        >
          \u2715
        </button>
        padding: "6px 12px",
        borderBottom: "1px solid #1e2235",
        display: "flex", alignItems: "center", gap: 10,
        background: "#0f1219",
        flexShrink: 0,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: connected ? "#22c55e" : "#ef4444",
          boxShadow: connected ? "0 0 6px #22c55e" : "none",
          animation: connected ? "pulse 2s infinite" : "none",
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#818cf8", textTransform: "uppercase", letterSpacing: ".5px" }}>
          Logs
        </span>
        <span style={{ fontSize: 12, color: "#cbd5e1", fontWeight: 500 }}>
          {pod}
        </span>
        <span style={{ fontSize: 11, color: "#64748b" }}>/ {namespace}</span>
        {container && <span style={{ fontSize: 11, color: "#475569" }}>({container})</span>}

        <div style={{ flex: 1 }} />

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter…"
          style={{
            width: 160, background: "#161b27", border: "1px solid #2d3555",
            color: "#e2e8f0", borderRadius: 5, padding: "3px 8px", fontSize: 11,
          }}
        />

        <button
          onClick={() => setPaused(p => !p)}
          style={{
            background: paused ? "#f59e0b22" : "#22c55e22",
            border: `1px solid ${paused ? "#f59e0b" : "#22c55e"}`,
            color: paused ? "#f59e0b" : "#22c55e",
            borderRadius: 5, padding: "3px 8px", fontSize: 10,
            fontWeight: 700, cursor: "pointer",
          }}
        >
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>

        <button
          onClick={() => { setLines([]); }}
          title="Clear"
          style={{
            background: "transparent", border: "1px solid #2d3555",
            color: "#64748b", borderRadius: 5, padding: "3px 8px",
            fontSize: 10, cursor: "pointer",
          }}
        >
          Clear
        </button>

        <span style={{ fontSize: 10, color: "#475569" }}>{lines.length} lines</span>

        <button
          onClick={onClose}
          style={{
            background: "none", border: "none", color: "#64748b",
            cursor: "pointer", fontSize: 16, lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Log content */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "6px 12px",
        fontFamily: "'Cascadia Code','Consolas',monospace",
        fontSize: 11, lineHeight: 1.7,
      }}>
        {filtered.length === 0 && (
          <div style={{ color: "#475569", padding: "20px 0", textAlign: "center" }}>
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
