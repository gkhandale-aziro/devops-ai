import { useState, useEffect, useCallback, useRef, type ReactNode, type ChangeEvent } from "react";
import type { StoredEvent, TriageLevel, Snapshot, Analysis, IncidentStatus } from "../types";
import { LEVEL_COLORS, LEVEL_LABELS } from "../types";
import { api, readSSE } from "../api/client";
import { LevelBadge }   from "../components/LevelBadge";

const LEVELS: TriageLevel[] = ["SEV1", "SEV2", "SEV3"];

const STATUS_STYLES: Record<IncidentStatus, { color: string; bg: string; label: string }> = {
  open:         { color: "#fb7185", bg: "#2a0011",  label: "Open"         },
  acknowledged: { color: "#fbbf24", bg: "#2a1a00",  label: "Acknowledged" },
  resolved:     { color: "#22c55e", bg: "#0a2a1a",  label: "Resolved"     },
};

// ── relative time helper ──────────────────────────────────────────────────────
function relativeTime(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function History() {
  const [events,        setEvents]        = useState<StoredEvent[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [loadError,     setLoadError]     = useState("");
  const [level,         setLevel]         = useState<TriageLevel | "">("");
  const [objFilter,     setObjFilter]     = useState("");
  const [objInput,      setObjInput]      = useState(""); // debounced input
  const [selectedId,    setSelectedId]    = useState<number | null>(null);
  const [detail,        setDetail]        = useState<StoredEvent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [aiText,        setAiText]        = useState("");
  const [aiLoading,     setAiLoading]     = useState(false);
  const [aiCache,       setAiCache]       = useState<Record<number, string>>({});

  // ── debounce object filter ────────────────────────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleObjInput(val: string) {
    setObjInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setObjFilter(val), 300);
  }

  // ── auto-refresh every 30s ────────────────────────────────────────────────
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [level, objFilter]);

  async function load() {
    setLoadError("");
    try {
      const params: { level?: TriageLevel; object?: string; limit?: number } = { limit: 100 };
      if (level)     params.level  = level;
      if (objFilter) params.object = objFilter;
      setEvents(await api.events.list(params));
    } catch {
      setLoadError("Failed to load events — is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(id: number) {
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(null);
    setAiText(aiCache[id] ?? "");
    try {
      const ev = await api.events.get(id);
      setDetail(ev);
      if (!aiCache[id]) runAI(ev);
    } finally {
      setDetailLoading(false);
    }
  }

  const runAI = useCallback(async (ev: StoredEvent) => {
    setAiLoading(true);
    setAiText("");
    const snaps  = (ev.snapshots ?? [])
      .map(s => `\n── ${s.kind} ──\n${s.content?.slice(0, 1500)}`)
      .join("\n");
    const prompt =
      `You are a Kubernetes SRE. Explain this incident clearly and suggest remediation steps.\n\n` +
      `Severity: ${ev.level} (${LEVEL_LABELS[ev.level]})\n` +
      `Reason: ${ev.reason}\nObject: ${ev.object}${ev.namespace ? " / " + ev.namespace : ""}\n` +
      `Source: ${ev.source}\nTime: ${ev.timestamp}\nMessage: ${ev.message ?? "—"}\n${snaps}`;
    try {
      const res = await api.analyzeStream(prompt);
      let full = "";
      for await (const chunk of readSSE(res)) {
        if (typeof chunk.t === "string") {
          full += chunk.t;
          setAiText(full);
        }
      }
      setAiCache((prev: Record<number, string>) => ({ ...prev, [ev.id]: full }));
    } catch {
      setAiText("AI explanation failed. Check your AI model config.");
    } finally {
      setAiLoading(false);
    }
  }, []);

  async function updateStatus(ev: StoredEvent, status: IncidentStatus) {
    await api.events.updateStatus(ev.id, status);
    setDetail((d: StoredEvent | null) => d ? { ...d, status } : d);
    setEvents((prev: StoredEvent[]) => prev.map((e: StoredEvent) => e.id === ev.id ? { ...e, status } : e));
  }

  const sevColor = (level: TriageLevel) => LEVEL_COLORS[level].border;

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

      {/* ── Left sidebar ───────────────────────────────────────────────────── */}
      <div style={{ width: 220, background: "#0d1117", borderRight: "1px solid #2d3148", padding: 14, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>

        <div>
          <Label>Severity</Label>
          <select
            value={level}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setLevel(e.target.value as TriageLevel | "")}
            style={{ width: "100%", background: "#0f1117", border: "1px solid #2d3148", color: "#e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 13 }}
          >
            <option value="">All severities</option>
            {LEVELS.map(l => <option key={l} value={l}>{l} — {LEVEL_LABELS[l]}</option>)}
          </select>
        </div>

        <div>
          <Label>Object</Label>
          <input
            value={objInput}
            onChange={e => handleObjInput(e.target.value)}
            placeholder="pod / node name"
            style={{ width: "100%", background: "#0f1117", border: "1px solid #2d3148", color: "#e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 13, outline: "none" }}
          />
        </div>

        <button
          onClick={() => { setLevel(""); setObjInput(""); setObjFilter(""); }}
          style={{ background: "#1a1d27", border: "1px solid #2d3148", color: "#64748b", borderRadius: 6, padding: 7, fontSize: 12, cursor: "pointer" }}
        >
          Clear filters
        </button>

        {/* quick severity filters */}
        <div style={{ marginTop: "auto" }}>
          <Label>Quick filters</Label>
          {LEVELS.map(l => {
            const c = LEVEL_COLORS[l];
            return (
              <button key={l} onClick={() => setLevel(l)} style={{
                display: "block", width: "100%", textAlign: "left",
                background: level === l ? c.bg : "transparent",
                border: `1px solid ${level === l ? c.border : "#2d3148"}`,
                color: level === l ? c.text : "#64748b",
                borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer", marginBottom: 4,
              }}>
                {l} — {LEVEL_LABELS[l]}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Event table ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #2d3148", display: "flex", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 14 }}>Incident History</strong>
          <span style={{ fontSize: 12, color: "#64748b", marginLeft: "auto" }}>
            {loading ? "Loading…" : `${events.length} event${events.length !== 1 ? "s" : ""}`}
          </span>
          <button
            onClick={load}
            title="Refresh"
            style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14, padding: "2px 6px" }}
          >↺</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {loadError && (
            <div style={{ margin: 16, padding: "10px 14px", background: "#2a0011", border: "1px solid #f43f5e", borderRadius: 6, fontSize: 12, color: "#fb7185" }}>
              {loadError}
            </div>
          )}

          {/* skeleton */}
          {loading && !loadError && (
            <div style={{ padding: "8px 0" }}>
              {[...Array(6)].map((_, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "10px 16px", borderBottom: "1px solid #1e2130" }}>
                  <div style={{ width: 60, height: 18, background: "#1a1d27", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
                  <div style={{ width: 80, height: 18, background: "#1a1d27", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
                  <div style={{ flex: 1, height: 18, background: "#1a1d27", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
                </div>
              ))}
            </div>
          )}

          {!loading && !loadError && events.length === 0 && (
            <div style={{ textAlign: "center", color: "#64748b", fontSize: 13, paddingTop: 60 }}>
              No incidents recorded yet. Start monitoring to capture events.
            </div>
          )}

          {events.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#0d1117", position: "sticky", top: 0, zIndex: 1 }}>
                  {["", "Severity", "Time", "Reason", "Object / Source", "Status"].map((h, i) => (
                    <th key={i} style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", borderBottom: "1px solid #2d3148" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map(e => {
                  const isSelected = e.id === selectedId;
                  const ss = STATUS_STYLES[e.status ?? "open"];
                  return (
                    <tr
                      key={e.id}
                      onClick={() => openDetail(e.id)}
                      style={{
                        borderBottom: "1px solid #1e2130",
                        cursor: "pointer",
                        background: isSelected ? "#1a2040" : "transparent",
                        transition: "background .1s",
                      }}
                      onMouseEnter={ev => { if (!isSelected) ev.currentTarget.style.background = "#1a1d27"; }}
                      onMouseLeave={ev => { if (!isSelected) ev.currentTarget.style.background = "transparent"; }}
                    >
                      {/* severity stripe */}
                      <td style={{ width: 3, padding: 0, background: sevColor(e.level) }} />
                      <td style={{ padding: "9px 12px" }}><LevelBadge level={e.level} /></td>
                      <td style={{ padding: "9px 12px", fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>
                        <span title={e.timestamp}>{relativeTime(e.timestamp)}</span>
                      </td>
                      <td style={{ padding: "9px 12px", fontSize: 13 }}>{e.reason}</td>
                      <td style={{ padding: "9px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{e.object}</div>
                        <div style={{ fontSize: 10, color: "#64748b" }}>{e.source}{e.namespace ? ` / ${e.namespace}` : ""}</div>
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: ss.color, background: ss.bg, border: `1px solid ${ss.color}44`, borderRadius: 4, padding: "2px 7px" }}>
                          {ss.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Detail drawer ──────────────────────────────────────────────────── */}
      {(detail || detailLoading) && (
        <div style={{ width: 480, background: "#1a1d27", borderLeft: "1px solid #2d3148", display: "flex", flexDirection: "column", flexShrink: 0 }}>

          {/* drawer header */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #2d3148", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {detail && <LevelBadge level={detail.level} showLabel />}
            <strong style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {detail?.reason ?? "Loading…"}
            </strong>
            <button onClick={() => { setDetail(null); setSelectedId(null); }}
              style={{ background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {detailLoading && <Skeleton />}

            {detail && (
              <>
                {/* meta */}
                <div style={{ background: "#12141f", border: "1px solid #2d3148", borderRadius: 8, padding: 12, marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                  <MetaRow label="Object"    value={detail.object} />
                  <MetaRow label="Namespace" value={detail.namespace || "—"} />
                  <MetaRow label="Source"    value={detail.source} />
                  <MetaRow label="Time"      value={relativeTime(detail.timestamp)} title={detail.timestamp} />
                </div>

                {/* status controls */}
                <div style={{ marginBottom: 14 }}>
                  <Label>Status</Label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["open", "acknowledged", "resolved"] as IncidentStatus[]).map(s => {
                      const ss = STATUS_STYLES[s];
                      const active = (detail.status ?? "open") === s;
                      return (
                        <button
                          key={s}
                          onClick={() => updateStatus(detail, s)}
                          style={{
                            flex: 1, padding: "6px 8px", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer",
                            background: active ? ss.bg   : "#12141f",
                            border:     `1px solid ${active ? ss.color : "#2d3148"}`,
                            color:      active ? ss.color : "#64748b",
                            transition: "all .15s",
                          }}
                        >
                          {ss.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* event message */}
                {detail.message && (
                  <Section label="Event Message">
                    <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>{detail.message}</div>
                  </Section>
                )}

                {/* AI explanation — prominent, at top of data */}
                <Section label={
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "#7c8cf8" }}>✦ AI Explanation</span>
                    {aiLoading && <span style={{ fontSize: 10, color: "#7c8cf8", animation: "pulse 1.5s infinite" }}>thinking…</span>}
                    {!aiLoading && aiText && (
                      <button
                        onClick={() => runAI(detail)}
                        style={{ marginLeft: "auto", background: "none", border: "none", color: "#64748b", fontSize: 11, cursor: "pointer", padding: 0 }}
                        title="Re-run AI explanation"
                      >↺ re-run</button>
                    )}
                  </div>
                }>
                  <div style={{
                    background: "#0d1117", border: `1px solid ${aiLoading ? "#7c8cf8" : "#2d3148"}`,
                    borderRadius: 6, padding: 12, fontSize: 12, lineHeight: 1.7,
                    whiteSpace: "pre-wrap", minHeight: 64,
                    color: aiText ? "#e2e8f0" : "#64748b",
                    transition: "border-color .3s",
                  }}>
                    {aiText || (aiLoading ? "Analyzing incident…" : "—")}
                  </div>
                </Section>

                {/* snapshots — collapsible */}
                {(["describe", "logs", "logs_previous", "events"] as Snapshot["kind"][]).map(kind => {
                  const snap = detail.snapshots?.find(s => s.kind === kind);
                  if (!snap) return null;
                  const labels: Record<string, string> = {
                    describe: "kubectl describe", logs: "kubectl logs",
                    logs_previous: "kubectl logs --previous", events: "Cluster events",
                  };
                  return (
                    <CollapsibleSection key={kind} label={labels[kind]}>
                      <pre style={{ background: "#0d1117", color: "#c9d1d9", borderRadius: 6, padding: 10, fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto", margin: 0 }}>
                        {snap.content}
                      </pre>
                    </CollapsibleSection>
                  );
                })}

                {/* remediation from auto-monitor (if any) */}
                {(detail.analyses ?? []).slice(-1).map((a: Analysis) => a.remediation ? (
                  <Section key={a.id} label="Proposed Remediation (from monitor)">
                    <div style={{ background: "#12141f", border: "1px solid #f59e0b44", borderRadius: 6, padding: 12, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "#fbbf24" }}>
                      {a.remediation}
                    </div>
                  </Section>
                ) : null)}

                {/* footer actions */}
                <div style={{ display: "flex", gap: 10, marginTop: 8, paddingTop: 12, borderTop: "1px solid #2d3148" }}>
                  <button
                    onClick={() => { setObjInput(detail.object); setObjFilter(detail.object); setDetail(null); setSelectedId(null); }}
                    style={{ background: "none", border: "none", color: "#7c8cf8", fontSize: 12, cursor: "pointer", padding: 0 }}
                  >
                    View all for {detail.object} →
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes shimmer { 0%{background-position:-200px 0} 100%{background-position:200px 0} }
      `}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Label({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: "#64748b", marginBottom: 4 }}>{children}</div>;
}

function MetaRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</div>
      <div style={{ fontSize: 12, color: "#e2e8f0", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={title}>{value}</div>
    </div>
  );
}

function Section({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", letterSpacing: ".5px", marginBottom: 5 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function CollapsibleSection({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 10 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "5px 0", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
      >
        <span style={{ fontSize: 10, color: "#64748b" }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: "#64748b" }}>{label}</span>
      </button>
      {open && children}
    </div>
  );
}

function Skeleton() {
  return (
    <div>
      {[120, 80, 200, 160].map((w, i) => (
        <div key={i} style={{ height: 14, width: w, background: "#1e2130", borderRadius: 4, marginBottom: 12, opacity: 0.7 }} />
      ))}
    </div>
  );
}
