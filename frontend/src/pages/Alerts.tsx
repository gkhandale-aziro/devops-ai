import { useState, useCallback } from "react";
import type { Target, MonitorAlert, TriageLevel, SSEEvent } from "../types";
import { LEVEL_COLORS, LEVEL_LABELS } from "../types";
import { api }           from "../api/client";
import { useMonitorSSE } from "../hooks/useSSE";
import { AlertCard }     from "../components/AlertCard";
import { AIDrawer }      from "../components/AIDrawer";
import { EmptyState }    from "../components/ui/empty-state";
import { Bell }          from "lucide-react";
import { toast }         from "../utils/toast";

interface Props {
  targets:         Target[];
  monitorActive:   boolean;
  onMonitorChange: (active: boolean) => void;
}

type AlertEntry = MonitorAlert & { ts: string; id: number; acknowledged?: boolean };

const LEVELS: TriageLevel[] = ["SEV1", "SEV2", "SEV3"];

export function Alerts({ targets, monitorActive, onMonitorChange }: Props) {
  const [alerts,      setAlerts]      = useState<AlertEntry[]>([]);
  const [filter,      setFilter]      = useState<TriageLevel | "all">("all");
  const [selectedTid, setSelectedTid] = useState(() =>
    localStorage.getItem("alerts_selectedTid") ?? ""
  );
  const [starting,    setStarting]    = useState(false);

  // AI drawer
  const [aiOpen,    setAiOpen]    = useState(false);
  const [aiContext, setAiContext] = useState("");
  const [aiTitle,   setAiTitle]   = useState("");

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

  function ackAlert(id: number) {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a));
    toast.success("Alert acknowledged");
  }

  function openAIForAlert(a: AlertEntry) {
    const prompt =
      `You are a Kubernetes SRE. Explain this live alert clearly and suggest what to do next.\n\n` +
      `Severity: ${a.level} (${LEVEL_LABELS[a.level]})\n` +
      `Reason: ${a.reason}\nObject: ${a.object}${a.namespace ? " / " + a.namespace : ""}\n` +
      `Source: ${a.source}\nTime: ${a.ts}\nMessage: ${a.message ?? "—"}`;
    setAiContext(prompt);
    setAiTitle(`AI: ${a.reason} — ${a.object}`);
    setAiOpen(true);
  }

  const visible = filter === "all" ? alerts : alerts.filter(a => a.level === filter);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", margin: -1 }}>Live Alerts</h1>

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <div style={{
        padding: "12px 20px",
        borderBottom: "1px solid var(--c-border)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexShrink: 0,
        flexWrap: "wrap",
        background: "var(--c-bg-raised)",
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: monitorActive ? "#ef4444" : "var(--c-text-muted)",
          display: "inline-block",
          animation: monitorActive ? "pulse 1.5s infinite" : "none",
          flexShrink: 0,
        }}
        aria-label={monitorActive ? "Monitor is active" : "Monitor is inactive"}
        role="status" />

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {/* Severity counters */}
          <div style={{ display: "flex", gap: 6 }}>
            {LEVELS.map(l => {
              const c = LEVEL_COLORS[l];
              return (
                <div key={l} style={{
                  background: c.bg, border: `1px solid ${c.border}`,
                  borderRadius: 8, padding: "4px 10px", textAlign: "center",
                  display: "flex", alignItems: "center", gap: 6, minWidth: 56,
                }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: c.text }}>{counts[l]}</span>
                  <span style={{ fontSize: 10, color: "var(--c-text-muted)" }}>{l}</span>
                </div>
              );
            })}
          </div>

          <div style={{ width: 1, height: 20, background: "var(--c-border-strong)", flexShrink: 0 }} />

          {/* Filter pills */}
          <div style={{ display: "flex", gap: 4 }}>
            {(["all", ...LEVELS] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: "4px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  background: filter === f ? (f === "all" ? "var(--c-bg-active)" : LEVEL_COLORS[f].bg) : "transparent",
                  border: `1px solid ${filter === f ? (f === "all" ? "var(--c-accent-hover)" : LEVEL_COLORS[f].border) : "var(--c-border-strong)"}`,
                  color: filter === f ? (f === "all" ? "var(--c-accent-hover)" : LEVEL_COLORS[f].text) : "var(--c-text-muted)",
                  transition: "background 100ms ease-out, border-color 100ms ease-out, color 100ms ease-out",
                }}
              >{f === "all" ? "All" : f}</button>
            ))}
          </div>

          <div style={{ width: 1, height: 20, background: "var(--c-border-strong)", flexShrink: 0 }} />

          {/* Target selector + start/stop */}
          <select
            value={selectedTid}
            onChange={e => { setSelectedTid(e.target.value); localStorage.setItem("alerts_selectedTid", e.target.value); }}
            disabled={monitorActive}
            aria-label="Select target to monitor"
            style={{
              background: "var(--c-bg-surface)",
              border: "1px solid var(--c-border-strong)",
              color: "var(--c-text-primary)",
              borderRadius: 6,
              padding: "5px 10px",
              fontSize: 12,
              outline: "none",
              minWidth: 140,
            }}
          >
            <option value="">— target —</option>
            {targets.map(t => (
              <option key={t.id} value={t.id}>{t.name} ({t.type})</option>
            ))}
          </select>

          {!monitorActive ? (
            <button
              onClick={startMonitor}
              disabled={!selectedTid || starting}
              style={{
                background: "#16a34a", border: "none", color: "#fff",
                borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600,
                cursor: selectedTid ? "pointer" : "not-allowed",
                opacity: selectedTid ? 1 : 0.5,
              }}
            >{starting ? "Starting…" : "Start"}</button>
          ) : (
            <button
              onClick={stopMonitor}
              style={{
                background: "#b91c1c", border: "none", color: "#fff",
                borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600,
                cursor: "pointer",
              }}
            >Stop</button>
          )}

          {alerts.length > 0 && (
            <button
              onClick={() => setAlerts([])}
              style={{ background: "none", border: "1px solid var(--c-border-strong)", color: "var(--c-text-muted)", borderRadius: 6, padding: "5px 10px", fontSize: 11, cursor: "pointer" }}
            >Clear</button>
          )}
        </div>
      </div>

      {/* ── Alert feed ─────────────────────────────────────────────────── */}
      <div
        role="feed"
        aria-busy={monitorActive}
        aria-live="polite"
        aria-label="Live alerts feed"
        style={{ flex: 1, overflowY: "auto", padding: "12px 20px", display: "flex", flexDirection: "column", gap: 8 }}
      >
        {visible.length === 0 && (
          <EmptyState
            icon={<Bell size={32} />}
            title={monitorActive ? "No alerts yet" : "Monitor not active"}
            description={monitorActive
              ? "Waiting for events from the monitored target."
              : "Start monitoring a target to see live alerts here."}
          />
        )}
        {visible.map(a => (
          <AlertCard key={a.id} alert={a} onClick={() => openAIForAlert(a)} onAck={() => ackAlert(a.id)} />
        ))}
      </div>

      {/* AI Drawer */}
      <AIDrawer open={aiOpen} context={aiContext} title={aiTitle} onClose={() => setAiOpen(false)} />

    </div>
  );
}
