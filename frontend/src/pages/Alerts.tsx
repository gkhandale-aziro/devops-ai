import { useState, useCallback, type Dispatch, type SetStateAction } from "react";
import type { Target, MonitorAlert, TriageLevel, SSEEvent } from "../types";
import { LEVEL_COLORS, LEVEL_LABELS } from "../types";
import { api }           from "../api/client";
import { useMonitorSSE } from "../hooks/useSSE";
import { AlertCard }     from "../components/AlertCard";
import { AIDrawer }      from "../components/AIDrawer";
import { EmptyState }    from "../components/ui/empty-state";
import { Bell, Plus, X, StopCircle } from "lucide-react";
import { Breadcrumb }    from "../components/ui/breadcrumb";
import { toast }         from "../utils/toast";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT } from "../utils/theme";

interface Props {
  targets:              Target[];
  monitoringTargets:    Set<string>;
  onMonitoringChange:   Dispatch<SetStateAction<Set<string>>>;
}

type AlertEntry = MonitorAlert & { ts: string; id: number; acknowledged?: boolean };

const LEVELS: TriageLevel[] = ["SEV1", "SEV2", "SEV3"];

export function Alerts({ targets, monitoringTargets, onMonitoringChange }: Props) {
  const [alerts,      setAlerts]      = useState<AlertEntry[]>([]);
  const [filter,      setFilter]      = useState<TriageLevel | "all">("all");
  const [selectedTid, setSelectedTid] = useState("");
  const [starting,    setStarting]    = useState(false);

  // AI drawer
  const [aiOpen,    setAiOpen]    = useState(false);
  const [aiContext, setAiContext] = useState("");
  const [aiTitle,   setAiTitle]   = useState("");

  const monitorActive = monitoringTargets.size > 0;

  const counts: Record<TriageLevel, number> = { SEV1: 0, SEV2: 0, SEV3: 0 };
  for (const a of alerts) counts[a.level]++;

  const onEvent = useCallback((e: SSEEvent) => {
    if (e.type !== "monitor_alert") return;
    const alert = e as MonitorAlert;
    const entry: AlertEntry = {
      type:        "monitor_alert",
      level:       alert.level,
      reason:      alert.reason,
      object:      alert.object,
      namespace:   alert.namespace,
      message:     alert.message,
      source:      alert.source,
      target_id:   alert.target_id,
      target_name: alert.target_name,
      ts:          new Date().toLocaleTimeString(),
      id:          Date.now() + Math.random(),
    };
    setAlerts((prev: AlertEntry[]) => [entry, ...prev].slice(0, 200));
  }, []);

  useMonitorSSE(monitorActive, onEvent);

  async function startMonitor() {
    if (!selectedTid) return;
    setStarting(true);
    try {
      await api.monitor.start(selectedTid);
      onMonitoringChange(prev => new Set([...prev, selectedTid]));
      const t = targets.find(t => t.id === selectedTid);
      toast.success(`Monitoring ${t?.name ?? "target"}`);
      setSelectedTid("");
    } catch {
      toast.error("Failed to start monitor");
    } finally {
      setStarting(false);
    }
  }

  async function stopTarget(tid: string) {
    try {
      await api.monitor.stop(tid);
      onMonitoringChange(prev => {
        const next = new Set(prev);
        next.delete(tid);
        return next;
      });
      // Clear alerts for this target
      setAlerts(prev => prev.filter(a => a.target_id !== tid));
      const t = targets.find(t => t.id === tid);
      toast.success(`Stopped monitoring ${t?.name ?? "target"}`);
    } catch {
      toast.error("Failed to stop monitor");
    }
  }

  async function stopAll() {
    await api.monitor.stop();
    onMonitoringChange(new Set());
    setAlerts([]);
    toast.success("All monitors stopped");
  }

  function ackAlert(id: number) {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a));
    toast.success("Alert acknowledged");
  }

  function openAIForAlert(a: AlertEntry) {
    const prompt =
      `You are a Kubernetes SRE. Explain this live alert clearly and suggest what to do next.\n\n` +
      `Target: ${a.target_name}\n` +
      `Severity: ${a.level} (${LEVEL_LABELS[a.level]})\n` +
      `Reason: ${a.reason}\nObject: ${a.object}${a.namespace ? " / " + a.namespace : ""}\n` +
      `Source: ${a.source}\nTime: ${a.ts}\nMessage: ${a.message ?? "—"}`;
    setAiContext(prompt);
    setAiTitle(`AI: ${a.reason} — ${a.object}`);
    setAiOpen(true);
  }

  const visible = filter === "all" ? alerts : alerts.filter(a => a.level === filter);

  // Group visible alerts by target
  const monitoredTargets = targets.filter(t => monitoringTargets.has(t.id));
  const unmonitoredTargets = targets.filter(t => !monitoringTargets.has(t.id));

  const alertsByTarget: Record<string, AlertEntry[]> = {};
  for (const tid of monitoringTargets) {
    alertsByTarget[tid] = [];
  }
  for (const a of visible) {
    if (alertsByTarget[a.target_id]) {
      alertsByTarget[a.target_id].push(a);
    }
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", margin: -1 }}>Live Alerts</h1>

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <div style={{
        padding: "12px 20px",
        borderBottom: "1px solid var(--c-border)",
        display: "flex",
        alignItems: "center",
        gap: SPACE.md,
        flexShrink: 0,
        flexWrap: "wrap",
        background: "var(--c-bg-raised)",
      }}>
        <Breadcrumb items={[
          { label: "Home", href: "/" },
          { label: "Live Alerts", icon: <Bell size={14} /> },
        ]} />

        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: monitorActive ? C.status.danger : C.text.muted,
          display: "inline-block",
          animation: monitorActive ? "pulse 1.5s infinite" : "none",
          flexShrink: 0,
        }}
        aria-label={monitorActive ? "Monitor is active" : "Monitor is inactive"}
        role="status" />

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {/* Severity counters */}
          <div style={{ display: "flex", gap: SPACE.sm }}>
            {LEVELS.map(l => {
              const c = LEVEL_COLORS[l];
              return (
                <div key={l} style={{
                  background: c.bg, border: `1px solid ${c.border}`,
                  borderRadius: RADIUS.lg, padding: `${SPACE.xs}px ${SPACE.sm}px`, textAlign: "center",
                  display: "flex", alignItems: "center", gap: SPACE.sm, minWidth: 56,
                }}>
                  <span style={{ fontSize: FONT_SIZE.lg, fontWeight: FONT_WEIGHT.bold, color: c.text }}>{counts[l]}</span>
                  <span style={{ fontSize: FONT_SIZE.xs, color: C.text.muted }}>{l}</span>
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
                  padding: `${SPACE.xs}px ${SPACE.sm}px`, borderRadius: RADIUS.xl, fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold, cursor: "pointer",
                  background: filter === f ? (f === "all" ? "var(--c-bg-active)" : LEVEL_COLORS[f].bg) : "transparent",
                  border: `1px solid ${filter === f ? (f === "all" ? "var(--c-accent-hover)" : LEVEL_COLORS[f].border) : "var(--c-border-strong)"}`,
                  color: filter === f ? (f === "all" ? "var(--c-accent-hover)" : LEVEL_COLORS[f].text) : "var(--c-text-muted)",
                  transition: "background 100ms ease-out, border-color 100ms ease-out, color 100ms ease-out",
                }}
              >{f === "all" ? "All" : f}</button>
            ))}
          </div>

          <div style={{ width: 1, height: 20, background: "var(--c-border-strong)", flexShrink: 0 }} />

          {/* Add target to monitor */}
          <div style={{ display: "flex", gap: SPACE.sm, alignItems: "center" }}>
            <select
              value={selectedTid}
              onChange={e => setSelectedTid(e.target.value)}
              aria-label="Select target to monitor"
              style={{
                background: "var(--c-bg-surface)",
                border: "1px solid var(--c-border-strong)",
                color: "var(--c-text-primary)",
                borderRadius: RADIUS.md,
                padding: `${SPACE.xs}px ${SPACE.sm}px`,
                fontSize: FONT_SIZE.sm,
                outline: "none",
                minWidth: 140,
              }}
            >
              <option value="">— add target —</option>
              {unmonitoredTargets.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.type})</option>
              ))}
            </select>

            <button
              onClick={startMonitor}
              disabled={!selectedTid || starting}
              aria-label="Start monitoring selected target"
              style={{
                background: C.status.success, border: "none", color: "#fff",
                borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold,
                cursor: selectedTid ? "pointer" : "not-allowed",
                opacity: selectedTid ? 1 : 0.5,
                display: "flex", alignItems: "center", gap: SPACE.xs,
              }}
            ><Plus size={14} /> {starting ? "Starting…" : "Add"}</button>
          </div>

          {monitorActive && (
            <button
              onClick={stopAll}
              style={{
                background: C.status.danger, border: "none", color: "#fff",
                borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold,
                cursor: "pointer", display: "flex", alignItems: "center", gap: SPACE.xs,
              }}
            ><StopCircle size={14} /> Stop All</button>
          )}
        </div>
      </div>

      {/* ── Alert feed grouped by target ──────────────────────────────── */}
      <div
        role="feed"
        aria-busy={monitorActive}
        aria-live="polite"
        aria-label="Live alerts feed"
        style={{ flex: 1, overflowY: "auto", padding: "12px 20px", display: "flex", flexDirection: "column", gap: SPACE.md }}
      >
        {!monitorActive && (
          <EmptyState
            icon={<Bell size={32} />}
            title="Monitor not active"
            description="Select a target above and click Add to start monitoring."
          />
        )}

        {monitoredTargets.map(t => {
          const tAlerts = alertsByTarget[t.id] ?? [];
          return (
            <div key={t.id} style={{
              border: "1px solid var(--c-border)",
              borderRadius: RADIUS.lg,
              overflow: "hidden",
            }}>
              {/* Target header */}
              <div style={{
                display: "flex", alignItems: "center", gap: SPACE.sm,
                padding: `${SPACE.sm}px ${SPACE.md}px`,
                background: "var(--c-bg-raised)",
                borderBottom: "1px solid var(--c-border)",
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: C.status.success,
                  animation: "pulse 2s infinite",
                  flexShrink: 0,
                }} />
                <span style={{ fontWeight: FONT_WEIGHT.semibold, fontSize: FONT_SIZE.md, color: "var(--c-text-primary)" }}>
                  {t.name}
                </span>
                <span style={{ fontSize: FONT_SIZE.xs, color: C.text.muted }}>
                  {t.type}
                </span>
                <span style={{
                  fontSize: FONT_SIZE.xs, color: C.text.muted,
                  background: "var(--c-bg-surface)",
                  padding: `2px ${SPACE.sm}px`,
                  borderRadius: RADIUS.md,
                  marginLeft: SPACE.xs,
                }}>
                  {tAlerts.length} alert{tAlerts.length !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={() => stopTarget(t.id)}
                  aria-label={`Stop monitoring ${t.name}`}
                  style={{
                    marginLeft: "auto",
                    background: "none", border: `1px solid var(--c-border-strong)`,
                    color: C.text.muted, borderRadius: RADIUS.md,
                    padding: `${SPACE.xs}px ${SPACE.sm}px`, fontSize: FONT_SIZE.xs,
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                    transition: "color 100ms, border-color 100ms",
                  }}
                  className="hover-text-accent hover-border-accent"
                ><X size={12} /> Stop</button>
              </div>

              {/* Alerts for this target */}
              <div style={{
                padding: SPACE.sm,
                display: "flex", flexDirection: "column", gap: SPACE.sm,
                maxHeight: 400, overflowY: "auto",
              }}>
                {tAlerts.length === 0 ? (
                  <div style={{
                    padding: `${SPACE.lg}px`,
                    textAlign: "center",
                    color: C.text.muted,
                    fontSize: FONT_SIZE.sm,
                  }}>
                    No alerts — listening for events…
                  </div>
                ) : (
                  tAlerts.map(a => (
                    <AlertCard key={a.id} alert={a} onClick={() => openAIForAlert(a)} onAck={() => ackAlert(a.id)} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* AI Drawer */}
      <AIDrawer open={aiOpen} context={aiContext} title={aiTitle} onClose={() => setAiOpen(false)} />

    </div>
  );
}
