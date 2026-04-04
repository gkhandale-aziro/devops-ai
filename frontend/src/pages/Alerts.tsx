import { useState, useCallback, type ReactNode } from "react";
import type { Target, MonitorAlert, TriageLevel, SSEEvent } from "../types";
import { LEVEL_COLORS, LEVEL_LABELS } from "../types";
import { api }           from "../api/client";
import { useMonitorSSE } from "../hooks/useSSE";
import { AlertCard }     from "../components/AlertCard";

interface Props {
  targets:         Target[];
  monitorActive:   boolean;
  onMonitorChange: (active: boolean) => void;
}

type AlertEntry = MonitorAlert & { ts: string; id: number };

const LEVELS: TriageLevel[] = ["SEV1", "SEV2", "SEV3"];

export function Alerts({ targets, monitorActive, onMonitorChange }: Props) {
  const [alerts,      setAlerts]      = useState<AlertEntry[]>([]);
  const [filter,      setFilter]      = useState<TriageLevel | "all">("all");
  const [selectedTid, setSelectedTid] = useState(() =>
    localStorage.getItem("alerts_selectedTid") ?? ""
  );
  const [starting,    setStarting]    = useState(false);

  // count per level without implicit any
  const counts: Record<TriageLevel, number> = { SEV1: 0, SEV2: 0, SEV3: 0 };
  for (const a of alerts) counts[a.level]++;

  const onEvent = useCallback((e: SSEEvent) => {
    if (e.type !== "monitor_alert") return;
    const alert = e as MonitorAlert;
    const entry: AlertEntry = {
      type:      "monitor_alert",
      level:     alert.level,
      reason:    alert.reason,
      object:    alert.object,
      namespace: alert.namespace,
      message:   alert.message,
      source:    alert.source,
      ts:        new Date().toLocaleTimeString(),
      id:        Date.now(),
    };
    setAlerts((prev: AlertEntry[]) => [entry, ...prev].slice(0, 200));
  }, []);

  useMonitorSSE(monitorActive, onEvent);

  async function startMonitor() {
    if (!selectedTid) return;
    setStarting(true);
    try {
      await api.monitor.start(selectedTid);
      onMonitorChange(true);
    } finally {
      setStarting(false);
    }
  }

  async function stopMonitor() {
    await api.monitor.stop();
    onMonitorChange(false);
  }

  const visible = filter === "all" ? alerts : alerts.filter(a => a.level === filter);

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

      {/* sidebar */}
      <div style={{ width: 240, background: "#0d1117", borderRight: "1px solid #2d3148", padding: 14, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>

        <div>
          <Label>Target</Label>
          <select
            value={selectedTid}
            onChange={e => { setSelectedTid(e.target.value); localStorage.setItem("alerts_selectedTid", e.target.value); }}
            disabled={monitorActive}
            style={{ width: "100%", background: "#0f1117", border: "1px solid #2d3148", color: "#e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 13 }}
          >
            <option value="">— select —</option>
            {targets.map(t => (
              <option key={t.id} value={t.id}>{t.name} ({t.type})</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Label>Monitor</Label>
          {!monitorActive ? (
            <button
              onClick={startMonitor}
              disabled={!selectedTid || starting}
              style={{ background: "#16a34a", border: "none", color: "#fff", borderRadius: 6, padding: 8, fontSize: 13, fontWeight: 600, cursor: selectedTid ? "pointer" : "not-allowed", opacity: selectedTid ? 1 : 0.5 }}
            >
              {starting ? "Starting…" : "Start Monitoring"}
            </button>
          ) : (
            <button
              onClick={stopMonitor}
              style={{ background: "#b91c1c", border: "none", color: "#fff", borderRadius: 6, padding: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              Stop Monitoring
            </button>
          )}
          <div style={{ fontSize: 12, color: monitorActive ? "#22c55e" : "#64748b", background: "#1a1d27", border: `1px solid ${monitorActive ? "#22c55e" : "#2d3148"}`, borderRadius: 6, padding: "7px 10px" }}>
            {monitorActive ? "● Monitoring active" : "○ Not monitoring"}
          </div>
        </div>

        {/* counters */}
        <div>
          <Label>Counts</Label>
          <div style={{ display: "flex", gap: 6 }}>
            {LEVELS.map(l => {
              const c = LEVEL_COLORS[l];
              return (
                <div key={l} style={{ flex: 1, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 6, padding: "8px 6px", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: c.text }}>{counts[l]}</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>{l}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* filter */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Filter</Label>
          {(["all", ...LEVELS] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? (f === "all" ? "#1e2240" : LEVEL_COLORS[f].bg) : "#1a1d27",
                border:     `1px solid ${filter === f ? (f === "all" ? "#7c8cf8" : LEVEL_COLORS[f].border) : "#2d3148"}`,
                color:      filter === f ? (f === "all" ? "#7c8cf8" : LEVEL_COLORS[f].text) : "#94a3b8",
                borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer", textAlign: "left",
              }}
            >
              {f === "all" ? "All levels" : `${f} — ${LEVEL_LABELS[f]}`}
            </button>
          ))}
        </div>

        <button
          onClick={() => setAlerts([])}
          style={{ background: "#1a1d27", border: "1px solid #2d3148", color: "#64748b", borderRadius: 6, padding: 7, fontSize: 12, cursor: "pointer", marginTop: "auto" }}
        >
          Clear feed
        </button>
      </div>

      {/* main feed */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #2d3148", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: monitorActive ? "#ef4444" : "#64748b", display: "inline-block", animation: monitorActive ? "pulse 1.5s infinite" : "none" }} />
          <strong style={{ fontSize: 14 }}>Live Event Feed</strong>
          <span style={{ fontSize: 12, color: "#64748b", marginLeft: "auto" }}>
            {visible.length} alert{visible.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {visible.length === 0 && (
            <div style={{ textAlign: "center", color: "#64748b", fontSize: 13, paddingTop: 60 }}>
              {monitorActive
                ? "No alerts yet. Waiting for events…"
                : "Start monitoring a target to see live alerts here."}
            </div>
          )}
          {visible.map(a => <AlertCard key={a.id} alert={a} />)}
        </div>
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: "#64748b", marginBottom: 4 }}>
      {children}
    </div>
  );
}
