import { useState, useEffect, useRef, type ReactNode } from "react";
import type { StoredEvent, TriageLevel, Snapshot, Analysis, IncidentStatus } from "../types";
import { LEVEL_COLORS, LEVEL_LABELS, levelColor } from "../types";
import { api } from "../api/client";
import { LevelBadge }   from "../components/LevelBadge";
import { AIDrawer }      from "../components/AIDrawer";

const LEVELS: TriageLevel[] = ["SEV1", "SEV2", "SEV3"];

const STATUS_STYLES: Record<IncidentStatus, { color: string; bg: string; label: string }> = {
  open:         { color: "#fb7185", bg: "#2a0011",  label: "Open"         },
  acknowledged: { color: "#fbbf24", bg: "#2a1a00",  label: "Acknowledged" },
  resolved:     { color: "#22c55e", bg: "#0a2a1a",  label: "Resolved"     },
};

function relativeTime(ts: string): string {
  const ms = new Date(ts).getTime();
  if (isNaN(ms)) return ts;
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 0)    return "just now";
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
  const [objInput,      setObjInput]      = useState("");
  const [selectedId,    setSelectedId]    = useState<number | null>(null);
  const [detail,        setDetail]        = useState<StoredEvent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // AI drawer state
  const [aiDrawerOpen, setAiDrawerOpen]   = useState(false);
  const [aiContext,    setAiContext]       = useState("");
  const [aiTitle,      setAiTitle]        = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleObjInput(val: string) {
    setObjInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setObjFilter(val), 300);
  }

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
    try {
      const ev = await api.events.get(id);
      setDetail(ev);
    } finally {
      setDetailLoading(false);
    }
  }

  function openAIForEvent(ev: StoredEvent) {
    const snaps = (ev.snapshots ?? [])
      .map(s => `\n── ${s.kind} ──\n${s.content?.slice(0, 1500)}`)
      .join("\n");
    const prompt =
      `You are a Kubernetes SRE. Explain this incident clearly and suggest remediation steps.\n\n` +
      `Severity: ${ev.level} (${(LEVEL_LABELS as Record<string, string>)[ev.level] ?? ev.level})\n` +
      `Reason: ${ev.reason}\nObject: ${ev.object}${ev.namespace ? " / " + ev.namespace : ""}\n` +
      `Source: ${ev.source}\nTime: ${ev.timestamp}\nMessage: ${ev.message ?? "—"}\n${snaps}`;
    setAiContext(prompt);
    setAiTitle(`AI: ${ev.reason} — ${ev.object}`);
    setAiDrawerOpen(true);
  }

  async function updateStatus(ev: StoredEvent, status: IncidentStatus) {
    await api.events.updateStatus(ev.id, status);
    setDetail((d: StoredEvent | null) => d ? { ...d, status } : d);
    setEvents((prev: StoredEvent[]) => prev.map((e: StoredEvent) => e.id === ev.id ? { ...e, status } : e));
  }

  const sevColor = (lv: string) => levelColor(lv).border;
  const hasFilters = level !== "" || objInput !== "";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── Page header + filters (top bar) ─────────────────────────────── */}
      <div style={{
        padding: "12px 20px",
        borderBottom: "1px solid #1e2235",
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexShrink: 0,
        background: "#0f1219",
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c8cf8" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <strong style={{ fontSize: 15 }}>Incident History</strong>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {/* Severity filter pills */}
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setLevel("")}
              style={{
                padding: "4px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: level === "" ? "#1e2240" : "transparent",
                border: `1px solid ${level === "" ? "#7c8cf8" : "#2d3148"}`,
                color: level === "" ? "#7c8cf8" : "#64748b",
              }}
            >All</button>
            {LEVELS.map(l => {
              const c = LEVEL_COLORS[l];
              return (
                <button key={l} onClick={() => setLevel(l)} style={{
                  padding: "4px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  background: level === l ? c.bg : "transparent",
                  border: `1px solid ${level === l ? c.border : "#2d3148"}`,
                  color: level === l ? c.text : "#64748b",
                }}>{l}</button>
              );
            })}
          </div>

          {/* Object search */}
          <div style={{ position: "relative" }}>
            <input
              value={objInput}
              onChange={e => handleObjInput(e.target.value)}
              placeholder="Search object…"
              style={{
                background: "#161a26",
                border: "1px solid #2d3148",
                color: "#e2e8f0",
                borderRadius: 6,
                padding: "5px 10px 5px 30px",
                fontSize: 12,
                outline: "none",
                width: 180,
              }}
            />
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"
              style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)" }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>

          {hasFilters && (
            <button
              onClick={() => { setLevel(""); setObjInput(""); setObjFilter(""); }}
              style={{ background: "none", border: "none", color: "#64748b", fontSize: 11, cursor: "pointer", padding: "2px 6px" }}
            >Clear</button>
          )}

          <span style={{ fontSize: 12, color: "#475569" }}>|</span>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            {loading ? "Loading…" : `${events.length} event${events.length !== 1 ? "s" : ""}`}
          </span>
          <button
            onClick={load}
            title="Refresh"
            style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14, padding: "2px 6px" }}
          >↺</button>
        </div>
      </div>

      {/* ── Main content area ──────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Event table — full width */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loadError && (
              <div style={{ margin: 16, padding: "10px 14px", background: "#2a0011", border: "1px solid #f43f5e", borderRadius: 8, fontSize: 12, color: "#fb7185" }}>
                {loadError}
              </div>
            )}

            {loading && !loadError && (
              <div style={{ padding: "8px 0" }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, padding: "10px 20px", borderBottom: "1px solid #1e2130" }}>
                    <div style={{ width: 60, height: 18, background: "#1a1d27", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
                    <div style={{ width: 80, height: 18, background: "#1a1d27", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
                    <div style={{ flex: 1, height: 18, background: "#1a1d27", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
                  </div>
                ))}
              </div>
            )}

            {!loading && !loadError && events.length === 0 && (
              <div style={{ textAlign: "center", color: "#64748b", fontSize: 13, paddingTop: 80 }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2d3148" strokeWidth="1.2" style={{ marginBottom: 12 }}>
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <div>No incidents recorded yet.</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Start monitoring a target to capture events.</div>
              </div>
            )}

            {events.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#0d1117", position: "sticky", top: 0, zIndex: 1 }}>
                    {["", "Severity", "Time", "Reason", "Object / Source", "Status", ""].map((h, i) => (
                      <th key={i} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", borderBottom: "1px solid #2d3148" }}>
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
                        onMouseEnter={ev => { if (!isSelected) ev.currentTarget.style.background = "#14172266"; }}
                        onMouseLeave={ev => { if (!isSelected) ev.currentTarget.style.background = "transparent"; }}
                      >
                        <td style={{ width: 3, padding: 0, background: sevColor(e.level) }} />
                        <td style={{ padding: "9px 14px" }}><LevelBadge level={e.level} /></td>
                        <td style={{ padding: "9px 14px", fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>
                          <span title={e.timestamp}>{relativeTime(e.timestamp)}</span>
                        </td>
                        <td style={{ padding: "9px 14px" }}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{e.reason}</div>
                          {e.last_diagnosis && (
                            <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                              ✦ {e.last_diagnosis.slice(0, 80)}{e.last_diagnosis.length > 80 ? "…" : ""}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "9px 14px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{e.object}</div>
                          <div style={{ fontSize: 10, color: "#64748b" }}>{e.source}{e.namespace ? ` / ${e.namespace}` : ""}</div>
                        </td>
                        <td style={{ padding: "9px 14px" }}>
                          <span style={{ fontSize: 10, fontWeight: 600, color: ss.color, background: ss.bg, border: `1px solid ${ss.color}44`, borderRadius: 4, padding: "2px 7px" }}>
                            {ss.label}
                          </span>
                        </td>
                        <td style={{ padding: "9px 14px" }}>
                          <button
                            onClick={(ev) => { ev.stopPropagation(); openAIForEvent(e); }}
                            title="Ask AI about this incident"
                            style={{
                              background: "#7c8cf811",
                              border: "1px solid #7c8cf833",
                              color: "#7c8cf8",
                              borderRadius: 6,
                              padding: "4px 10px",
                              fontSize: 11,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            ✦ AI
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Detail panel ────────────────────────────────────────────── */}
        {(detail || detailLoading) && (
          <div style={{
            width: 420,
            background: "#13161f",
            borderLeft: "1px solid #2d3148",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            animation: "slideInRight .2s ease-out",
          }}>
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
                  {/* meta grid */}
                  <div style={{ background: "#0f1219", border: "1px solid #2d3148", borderRadius: 8, padding: 12, marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                    <MetaRow label="Object"    value={detail.object} />
                    <MetaRow label="Namespace" value={detail.namespace || "—"} />
                    <MetaRow label="Source"    value={detail.source} />
                    <MetaRow label="Time"      value={relativeTime(detail.timestamp)} title={detail.timestamp} />
                  </div>

                  {/* status buttons */}
                  <div style={{ marginBottom: 14 }}>
                    <FieldLabel>Status</FieldLabel>
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
                              background: active ? ss.bg : "#0f1219",
                              border: `1px solid ${active ? ss.color : "#2d3148"}`,
                              color: active ? ss.color : "#64748b",
                              transition: "all .15s",
                            }}
                          >{ss.label}</button>
                        );
                      })}
                    </div>
                  </div>

                  {detail.message && (
                    <Section label="Event Message">
                      <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>{detail.message}</div>
                    </Section>
                  )}

                  {/* AI explain button */}
                  <button
                    onClick={() => openAIForEvent(detail)}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      background: "#7c8cf811",
                      border: "1px solid #7c8cf833",
                      color: "#7c8cf8",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      marginBottom: 14,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <span>✦</span> Ask AI to Explain
                  </button>

                  {/* snapshots */}
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

                  {(detail.analyses ?? []).slice(-1).map((a: Analysis) => a.remediation ? (
                    <Section key={a.id} label="Proposed Remediation">
                      <div style={{ background: "#0f1219", border: "1px solid #f59e0b44", borderRadius: 6, padding: 12, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "#fbbf24" }}>
                        {a.remediation}
                      </div>
                    </Section>
                  ) : null)}

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
      </div>

      {/* AI Drawer */}
      <AIDrawer open={aiDrawerOpen} context={aiContext} title={aiTitle} onClose={() => setAiDrawerOpen(false)} />

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes slideInRight { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: ReactNode }) {
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
      <div style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", letterSpacing: ".5px", marginBottom: 5 }}>{label}</div>
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
