import { useState, useEffect, useCallback, type ReactNode, type ChangeEvent } from "react";
import type { StoredEvent, TriageLevel, Snapshot, Analysis } from "../types"; // Analysis used below
import { LEVEL_COLORS, LEVEL_LABELS } from "../types";
import { api, readSSE } from "../api/client";
import { LevelBadge }   from "../components/LevelBadge";

const LEVELS: TriageLevel[] = ["SEV1", "SEV2", "SEV3"];

export function History() {
  const [events,  setEvents]  = useState<StoredEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [level,   setLevel]   = useState<TriageLevel | "">("");
  const [objFilter, setObjFilter] = useState("");
  const [detail,        setDetail]        = useState<StoredEvent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [aiText,        setAiText]        = useState("");
  const [aiLoading,     setAiLoading]     = useState(false);

  useEffect(() => { load(); }, [level, objFilter]);

  async function load() {
    setLoading(true);
    try {
      const params: { level?: TriageLevel; object?: string; limit?: number } = { limit: 100 };
      if (level)     params.level  = level;
      if (objFilter) params.object = objFilter;
      setEvents(await api.events.list(params));
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(id: number) {
    setDetailLoading(true);
    setDetail(null);
    setAiText("");
    try {
      const ev = await api.events.get(id);
      setDetail(ev);
      // auto-run AI explanation
      runAI(ev);
    } finally {
      setDetailLoading(false);
    }
  }

  const runAI = useCallback(async (ev: StoredEvent) => {
    setAiLoading(true);
    setAiText("");
    const snaps  = (ev.snapshots ?? []).map(s => `\n── ${s.kind} ──\n${s.content?.slice(0, 1500)}`).join("\n");
    const prompt = `You are a Kubernetes SRE. Explain this incident clearly and suggest remediation.\n\nSeverity: ${ev.level}\nReason: ${ev.reason}\nObject: ${ev.object}${ev.namespace ? " / " + ev.namespace : ""}\nTime: ${ev.timestamp}\nMessage: ${ev.message ?? "—"}\n${snaps}`;
    try {
      const res = await api.analyzeStream(prompt);
      for await (const chunk of readSSE(res)) {
        if (typeof chunk.t === "string") setAiText((prev: string) => prev + chunk.t);
      }
    } catch {
      setAiText("AI explanation failed. Check your AI model config.");
    } finally {
      setAiLoading(false);
    }
  }, []);

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

      {/* sidebar */}
      <div style={{ width: 220, background: "#0d1117", borderRight: "1px solid #2d3148", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <Label>Level</Label>
          <select
            value={level}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setLevel(e.target.value as TriageLevel | "")}
            style={{ width: "100%", background: "#0f1117", border: "1px solid #2d3148", color: "#e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 13 }}
          >
            <option value="">All levels</option>
            {LEVELS.map(l => <option key={l} value={l}>{l} — {LEVEL_LABELS[l]}</option>)}
          </select>
        </div>

        <div>
          <Label>Object</Label>
          <input
            value={objFilter}
            onChange={e => setObjFilter(e.target.value)}
            placeholder="pod / node name"
            style={{ width: "100%", background: "#0f1117", border: "1px solid #2d3148", color: "#e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 13, outline: "none" }}
          />
        </div>

        <button
          onClick={() => { setLevel(""); setObjFilter(""); }}
          style={{ background: "#1a1d27", border: "1px solid #2d3148", color: "#64748b", borderRadius: 6, padding: 7, fontSize: 12, cursor: "pointer" }}
        >
          Clear filters
        </button>

        {/* quick links */}
        <div style={{ marginTop: "auto" }}>
          <Label>Quick filters</Label>
          {LEVELS.map(l => {
            const c = LEVEL_COLORS[l];
            return (
              <button key={l} onClick={() => setLevel(l)} style={{
                display: "block", width: "100%", textAlign: "left", background: level === l ? c.bg : "transparent",
                border: `1px solid ${level === l ? c.border : "#2d3148"}`, color: level === l ? c.text : "#64748b",
                borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer", marginBottom: 4,
              }}>
                {l} — {LEVEL_LABELS[l]}
              </button>
            );
          })}
        </div>
      </div>

      {/* table */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #2d3148", display: "flex", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 14 }}>Incident History</strong>
          <span style={{ fontSize: 12, color: "#64748b", marginLeft: "auto" }}>
            {loading ? "Loading…" : `${events.length} event${events.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {!loading && events.length === 0 && (
            <div style={{ textAlign: "center", color: "#64748b", fontSize: 13, paddingTop: 60 }}>
              No incidents recorded yet. Start monitoring to capture events.
            </div>
          )}
          {events.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#0d1117", position: "sticky", top: 0 }}>
                  {["Level", "Time", "Reason", "Object", "Namespace", "Last Diagnosis"].map(h => (
                    <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", borderBottom: "1px solid #2d3148" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr
                    key={e.id}
                    onClick={() => openDetail(e.id)}
                    style={{ borderBottom: "1px solid #1e2130", cursor: "pointer", transition: "background .1s" }}
                    onMouseEnter={ev => (ev.currentTarget.style.background = "#1a1d27")}
                    onMouseLeave={ev => (ev.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "9px 14px" }}><LevelBadge level={e.level} /></td>
                    <td style={{ padding: "9px 14px", fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>{e.timestamp.slice(0, 16)}</td>
                    <td style={{ padding: "9px 14px", fontSize: 13 }}>{e.reason}</td>
                    <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 500, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.object}</td>
                    <td style={{ padding: "9px 14px", fontSize: 12, color: "#64748b" }}>{e.namespace || "—"}</td>
                    <td style={{ padding: "9px 14px", fontSize: 12, color: "#94a3b8", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.last_diagnosis ? e.last_diagnosis.slice(0, 80) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* detail drawer */}
      {(detail || detailLoading) && (
        <div style={{
          width: 460, background: "#1a1d27", borderLeft: "1px solid #2d3148",
          overflowY: "auto", padding: 20, flexShrink: 0,
        }}>
          <button onClick={() => setDetail(null)} style={{ float: "right", background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>

          {detailLoading && <div style={{ color: "#64748b", fontSize: 13 }}>Loading…</div>}

          {detail && (
            <>
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <LevelBadge level={detail.level} showLabel />
                  <strong style={{ fontSize: 14 }}>{detail.reason}</strong>
                </div>
                <div style={{ fontSize: 13 }}>{detail.object}
                  {detail.namespace && <span style={{ color: "#64748b" }}> / {detail.namespace}</span>}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{detail.timestamp}</div>
              </div>

              {detail.message && (
                <Section label="Event Message">
                  <div style={{ fontSize: 13, color: "#94a3b8" }}>{detail.message}</div>
                </Section>
              )}

              {/* snapshots */}
              {(["describe", "logs", "logs_previous", "events"] as Snapshot["kind"][]).map(kind => {
                const snap = detail.snapshots?.find(s => s.kind === kind);
                if (!snap) return null;
                const labels: Record<string, string> = {
                  describe: "kubectl describe", logs: "kubectl logs",
                  logs_previous: "kubectl logs --previous", events: "Cluster events",
                };
                return (
                  <Section key={kind} label={labels[kind]}>
                    <pre style={{ background: "#0d1117", color: "#c9d1d9", borderRadius: 6, padding: 10, fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto", margin: 0 }}>
                      {snap.content}
                    </pre>
                  </Section>
                );
              })}

              {/* AI explanation — auto-runs on open */}
              <Section label={aiLoading ? "AI Explanation  ●  Thinking…" : "AI Explanation"}>
                <div style={{ background: "#12141f", border: `1px solid ${aiLoading ? "#7c8cf8" : "#2d3148"}`, borderRadius: 6, padding: 12, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", minHeight: 60, color: aiText ? "#e2e8f0" : "#64748b" }}>
                  {aiText || (aiLoading ? "Analyzing…" : "—")}
                </div>
                <button onClick={() => runAI(detail)} disabled={aiLoading} style={{ marginTop: 6, background: "none", border: "none", color: "#7c8cf8", fontSize: 11, cursor: aiLoading ? "default" : "pointer", padding: 0, opacity: aiLoading ? 0.5 : 1 }}>
                  ↺ Re-run explanation
                </button>
              </Section>

              {/* Saved analyses from auto-monitor (if any) */}
              {(detail.analyses ?? []).slice(-1).map((a: Analysis) => (
                <div key={a.id}>
                  {a.remediation && (
                    <Section label="Proposed Remediation (from monitor)">
                      <div style={{ background: "#12141f", border: "1px solid #f59e0b", borderRadius: 6, padding: 12, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "#fbbf24" }}>
                        {a.remediation}
                      </div>
                    </Section>
                  )}
                </div>
              ))}

              <button
                onClick={() => setObjFilter(detail.object)}
                style={{ background: "none", border: "none", color: "#7c8cf8", fontSize: 12, cursor: "pointer", padding: 0, marginTop: 8 }}
              >
                View all incidents for {detail.object} →
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: "#64748b", marginBottom: 4 }}>{children}</div>;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", letterSpacing: ".5px", marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}
