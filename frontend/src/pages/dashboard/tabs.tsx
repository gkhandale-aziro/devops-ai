/**
 * dashboard/tabs.tsx — per-tab content components extracted from Dashboard.tsx.
 */
import { useState, useMemo, useCallback, type ReactNode } from 'react';
import {
  Globe, Link2, Lock, ExternalLink, Rocket, Database, RefreshCw,
  ClipboardList, Zap, Clock, Package, HardDrive, Tag, BarChart3,
  Shield, MapPin, Plug, Map, Radio, Search, Check, X as XIcon,
  ChevronDown, ChevronRight,
  Users, FileText, AlertTriangle,
} from 'lucide-react';
import type { Target } from '../../types';
import { RingChart, Card, Pre } from './primitives';
import { KubectlTable, ResourceModal, hasKubectlData, serviceTypeColorFn, pvStatusColorFn, type ColorFn } from './tables';
import { MetricChart } from '../../components/ui/metric-chart';
import { EmptyState } from '../../components/ui/empty-state';
import { TimeRangePicker } from '../../components/ui/time-range-picker';
import { api } from '../../api/client';
import { useMetrics } from '../../hooks/useMetrics';
import { C } from '../../utils/theme';

// ── Resource detail helpers ──────────────────────────────────────────────────

/** Hook managing ResourceModal state — fetches describe/logs/AI data on open. */
function useResourceDetail(targetId: string) {
  const [resource, setResource] = useState<{ kind: string; name: string; ns: string; data: Record<string, string> } | null>(null);
  const [loading, setLoading] = useState(false);

  const open = useCallback(async (kind: string, name: string, ns: string) => {
    setLoading(true);
    try {
      const d = await api.resource(targetId, kind, name, ns);
      setResource({ kind, name, ns, data: d });
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  const close = useCallback(() => setResource(null), []);

  return { resource, loading, open, close };
}

/** Extracts name and namespace from a KubectlTable row click. */
function extractResourceFromRow(cols: string[], headers: string[]): { name: string; ns: string } {
  const nsIdx = headers.findIndex(h => h.toUpperCase() === 'NAMESPACE');
  const nameIdx = headers.findIndex(h => h.toUpperCase() === 'NAME');
  return {
    ns: nsIdx >= 0 ? cols[nsIdx] : '',
    name: nameIdx >= 0 ? cols[nameIdx] : cols[nsIdx >= 0 ? 1 : 0] ?? '',
  };
}

// ── Overview metric cards ─────────────────────────────────────────────────────

/** SSH/local target overview — uptime, disk, memory, hostname metric cards
 *  rendered via `RingChart` where a percentage is parseable, otherwise plain
 *  text. Falls back to `GenericTab` fields for any extra keys in `data`. */
export function OverviewTab({ data, targetId }: { data: Record<string, string>; targetId?: string }) {
  const uptime    = data.uptime ?? "";
  const memRaw    = data.memory ?? "";
  const diskRaw   = data.disk   ?? "";
  const cpuRaw    = data.cpu    ?? "";

  const uptimeMatch = uptime.match(/up\s+([^,]+)/);
  const uptimeStr   = uptimeMatch ? uptimeMatch[1].trim() : "—";
  const loadMatch   = uptime.match(/load average[s]?:\s*([\d.]+)/);
  const load        = loadMatch ? loadMatch[1] : "—";

  const memMatch = memRaw.match(/Mem:\s+(\d+)\s+(\d+)\s+(\d+)/);
  const memTotal = memMatch ? Math.round(+memMatch[1] / 1024 * 10) / 10 : 0;
  const memUsed  = memMatch ? Math.round(+memMatch[2] / 1024 * 10) / 10 : 0;
  const memPct   = memMatch ? Math.round(+memMatch[2] / +memMatch[1] * 100) : 0;

  const diskMatch = diskRaw.match(/(\S+)\s+(\S+)\s+(\S+)\s+(\d+)%/);
  const diskUsed  = diskMatch ? diskMatch[3] : "—";
  const diskTotal = diskMatch ? diskMatch[2] : "—";
  const diskPct   = diskMatch ? parseInt(diskMatch[4]) : 0;

  const cpuMatch = cpuRaw.match(/(\d+[\.,]\d+)\s*(?:us|%us|id)/);
  const cpuPct   = cpuMatch ? parseFloat(cpuMatch[1].replace(",", ".")) : 0;

  const os        = (data.os ?? "").replace(/PRETTY_NAME=/, "").replace(/"/g, "").trim() || "linux";
  const failedRaw = (data.failed_svc ?? "").trim();
  const failed    = failedRaw && failedRaw !== "[No output]"
    ? failedRaw.split("\n").filter(Boolean)
    : [];

  const pctColor  = (p: number) => p > 80 ? C.status.danger : p > 60 ? C.status.warning : C.status.success;
  const fillColor = (p: number) => p > 80 ? C.status.danger : p > 60 ? C.status.warning : C.status.success;

  const [range, setRange] = useState("1h");
  const { data: metricsData } = useMetrics(targetId, ["cpu_pct", "mem_pct", "disk_pct", "load_1m"], range);

  return (
    <div style={{ overflowY: "auto", padding: 16, flex: 1 }}>
      {/* metric cards — Skill #6: SVG ring charts instead of flat bars */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
        {[
          { label: "CPU Usage",  val: `${cpuPct}%`,  sub: `Load avg: ${load}`,            pct: cpuPct  },
          { label: "Memory",     val: `${memUsed}G`, sub: `of ${memTotal}G (${memPct}%)`, pct: memPct  },
          { label: "Disk",       val: diskUsed,       sub: `of ${diskTotal} (${diskPct}%)`, pct: diskPct },
          { label: "Uptime",     val: uptimeStr,      sub: os,                              pct: -1      },
        ].map(card => (
          <div key={card.label} style={{ background: C.bg.card, border: `1px solid ${C.border.muted}`, borderRadius: 10, padding: 16, boxShadow: "0 4px 16px rgba(0,0,0,.35)", display: "flex", alignItems: "center", gap: 14 }}>
            {card.pct >= 0
              ? <RingChart pct={card.pct} color={fillColor(card.pct)} size={52} />
              : <div style={{ width: 52, height: 52, borderRadius: "50%", background: `${C.accent.primary}18`, border: `2px solid ${C.accent.primary}33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.accent.primary} strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </div>
            }
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>{card.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: card.pct >= 0 ? pctColor(card.pct) : "#7c8cf8", lineHeight: 1 }}>{card.val}</div>
              <div style={{ fontSize: 10, color: C.text.muted, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Trend charts ───────────────────────────────────────── */}
      {targetId && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text.secondary }}>Trends</div>
            <TimeRangePicker value={range} onChange={setRange} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div style={{ background: C.bg.card, border: `1px solid ${C.border.muted}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: C.text.muted, marginBottom: 8, fontWeight: 600 }}>Memory Usage</div>
              <MetricChart data={metricsData.mem_pct ?? []} label="Memory" unit="%" color={C.status.info} height={140} thresholds={{ warn: 70, danger: 90 }} />
            </div>
            <div style={{ background: C.bg.card, border: `1px solid ${C.border.muted}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: C.text.muted, marginBottom: 8, fontWeight: 600 }}>Disk Usage</div>
              <MetricChart data={metricsData.disk_pct ?? []} label="Disk" unit="%" color={C.accent.soft} height={140} thresholds={{ warn: 80, danger: 95 }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 16 }}>
            <div style={{ background: C.bg.card, border: `1px solid ${C.border.muted}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, color: C.text.muted, marginBottom: 8, fontWeight: 600 }}>Load Average (1m)</div>
              <MetricChart data={metricsData.load_1m ?? []} label="Load" unit="" color={C.accent.primary} height={140} />
            </div>
          </div>
        </>
      )}

      {/* failed services + top procs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Card title={`Failed Services (${failed.length})`}>
          {failed.length === 0
            ? <div style={{ color: C.status.success, fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>All services healthy <Check size={13} /></div>
            : failed.map((s, i) => <div key={i} style={{ fontSize: 13, color: C.status.danger, marginBottom: 3 }}>• {s}</div>)
          }
        </Card>
        <Card title="Top Processes">
          <Pre>{data.top_procs ?? "—"}</Pre>
        </Card>
      </div>
    </div>
  );
}


// ── Generic ───────────────────────────────────────────────────────────────────

/** Catch-all dump for unknown tab shapes — renders every `data[key]` in a
 *  collapsible Card with a `<Pre>` body. Used as the default route in
 *  Dashboard's TabContent when no specialized component exists. */
export function GenericTab({ data }: { data: Record<string, string> }) {
  if (data.error) return <div style={{ padding: 20, color: C.status.danger }}>{data.error}</div>;
  const entries = Object.entries(data);
  if (!entries.length) return <EmptyState icon={<Database size={32} />} title="No data" description="This tab returned no information for the selected target." />;
  return (
    <div style={{ overflowY: "auto", padding: 16, flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
      {entries.map(([key, val]) => (
        <Card key={key} title={key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}>
          <Pre>{val}</Pre>
        </Card>
      ))}
    </div>
  );
}

// ── Events tab ────────────────────────────────────────────────────────────────

/** Kubernetes events tab — summary pills (normal vs warning) + `KubectlTable`.
 *  Warning/Error rows are colorized via a TYPE-column ColorFn. */
export function EventsTab({ data, target }: { data: Record<string, string>; target?: Target }) {
  const detail = useResourceDetail(target?.id ?? "");
  const raw = data.output ?? "";
  const colorFn: ColorFn = (val, col) => {
    if (col.toUpperCase() === "TYPE") {
      if (val === "Warning") return C.status.warning;
      if (val === "Normal")  return C.status.success;
    }
    return null;
  };

  const counts = useMemo(() => {
    let warning = 0, normal = 0;
    if (hasKubectlData(raw)) {
      for (const line of raw.split("\n").slice(1)) {
        if (/\bWarning\b/.test(line)) warning++;
        else if (/\bNormal\b/.test(line)) normal++;
      }
    }
    return { warning, normal, total: warning + normal };
  }, [raw]);

  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      {/* summary bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16, padding: "10px 16px",
        background: C.bg.panel, borderBottom: `1px solid ${C.border.subtle}`, flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text.primary }}>{counts.total} Events</span>
        <div style={{ width: 1, height: 20, background: C.border.muted }} />
        {counts.warning > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.status.warning, animation: "pulse 2s ease-in-out infinite" }} />
            <span style={{ fontSize: 12, color: C.status.warning, fontWeight: 600 }}>{counts.warning}</span>
            <span style={{ fontSize: 11, color: C.text.muted }}>Warning</span>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.status.success }} />
          <span style={{ fontSize: 12, color: C.status.success, fontWeight: 600 }}>{counts.normal}</span>
          <span style={{ fontSize: 11, color: C.text.muted }}>Normal</span>
        </div>
        {counts.total > 0 && (
          <>
            <div style={{ flex: 1 }} />
            <div style={{ width: 80, height: 5, borderRadius: 3, background: C.border.subtle, overflow: "hidden", display: "flex" }}>
              <div style={{ width: `${counts.normal / counts.total * 100}%`, background: C.status.success }} />
              <div style={{ width: `${counts.warning / counts.total * 100}%`, background: C.status.warning }} />
            </div>
          </>
        )}
      </div>
      <KubectlTable
        raw={raw}
        colorFn={colorFn}
        emptyMessage="No events in this namespace"
        onRowClick={target ? (cols, headers) => {
          const { name, ns } = extractResourceFromRow(cols, headers);
          detail.open("event", name, ns);
        } : undefined}
      />
      {(detail.resource || detail.loading) && (
        <ResourceModal resource={detail.resource} loading={detail.loading} targetId={target?.id ?? ""} onClose={detail.close} />
      )}
    </div>
  );
}

// ── Services tab ──────────────────────────────────────────────────────────────

/** Kubernetes services tab — summary pills per TYPE (LoadBalancer, NodePort,
 *  ClusterIP, ExternalName) + colorized `KubectlTable`. */
export function ServicesTab({ data, target }: { data: Record<string, string>; target?: Target }) {
  const detail = useResourceDetail(target?.id ?? "");
  const raw = data.services ?? "";

  const counts = useMemo(() => {
    const c = { lb: 0, np: 0, cip: 0, ext: 0, total: 0 };
    if (hasKubectlData(raw)) {
      for (const line of raw.split("\n").slice(1)) {
        if (!line.trim()) continue;
        c.total++;
        if (/\bLoadBalancer\b/.test(line)) c.lb++;
        else if (/\bNodePort\b/.test(line)) c.np++;
        else if (/\bExternalName\b/.test(line)) c.ext++;
        else c.cip++;
      }
    }
    return c;
  }, [raw]);

  const pills = [
    { label: "LoadBalancer", count: counts.lb,  color: C.accent.light, icon: <Globe size={14} /> },
    { label: "NodePort",     count: counts.np,  color: C.status.info, icon: <Link2 size={14} /> },
    { label: "ClusterIP",    count: counts.cip, color: C.text.muted, icon: <Lock size={14} /> },
    { label: "ExternalName", count: counts.ext, color: C.status.warning, icon: <ExternalLink size={14} /> },
  ];

  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      {/* summary */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        background: C.bg.panel, borderBottom: `1px solid ${C.border.subtle}`, flexShrink: 0, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text.primary }}>{counts.total} Services</span>
        <div style={{ width: 1, height: 20, background: C.border.muted }} />
        {pills.map(p => p.count > 0 && (
          <div key={p.label} style={{
            display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
            background: p.color + "15", border: `1px solid ${p.color}33`, borderRadius: 6,
          }}>
            <span style={{ fontSize: 11 }}>{p.icon}</span>
            <span style={{ fontSize: 12, color: p.color, fontWeight: 600 }}>{p.count}</span>
            <span style={{ fontSize: 11, color: C.text.secondary }}>{p.label}</span>
          </div>
        ))}
      </div>
      <KubectlTable
        raw={raw}
        colorFn={serviceTypeColorFn}
        emptyMessage="No services found"
        onRowClick={target ? (cols, headers) => {
          const { name, ns } = extractResourceFromRow(cols, headers);
          detail.open("service", name, ns);
        } : undefined}
      />
      {(detail.resource || detail.loading) && (
        <ResourceModal resource={detail.resource} loading={detail.loading} targetId={target?.id ?? ""} onClose={detail.close} />
      )}
    </div>
  );
}

// ── Workloads tab — visual overview with count cards + detail tables ──────────

interface WorkloadCounts {
  label:    string;
  key:      string;
  icon:     ReactNode;
  color:    string;
  total:    number;
  ready:    number;
  notReady: number;
}

/** Extracts {total, ready, notReady} from a `kubectl get <workload>` listing.
 *  `label` picks which column to read — "Pods" uses the READY column
 *  (e.g. "2/3"), other workloads use AVAILABLE vs DESIRED. */
export function parseWorkloadCounts(raw: string, label: string): { total: number; ready: number; notReady: number } {
  if (!hasKubectlData(raw)) return { total: 0, ready: 0, notReady: 0 };
  const lines = raw.trim().split("\n").slice(1); // skip header
  let total = 0, ready = 0, notReady = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    total++;
    const cols = line.trim().split(/\s+/);
    // Deployments: NAMESPACE NAME READY UP-TO-DATE AVAILABLE AGE — READY is col[2]
    // StatefulSets: NAMESPACE NAME READY AGE — READY is col[2]
    // DaemonSets: NAMESPACE NAME DESIRED CURRENT READY ...
    // Jobs: NAMESPACE NAME COMPLETIONS DURATION AGE — COMPLETIONS is col[2]
    const readyCol = cols[2] ?? "";
    if (readyCol.includes("/")) {
      const [cur, max] = readyCol.split("/").map(Number);
      if (cur >= max && max > 0) ready++;
      else notReady++;
    } else if (label === "DaemonSets") {
      // DESIRED CURRENT READY — compare col[2] desired to col[4] ready
      const desired = parseInt(cols[2] ?? "0");
      const rdy     = parseInt(cols[4] ?? "0");
      if (rdy >= desired && desired > 0) ready++;
      else if (desired > 0) notReady++;
      else ready++;
    } else {
      ready++; // can't parse ready state, assume ok
    }
  }
  return { total, ready, notReady };
}

/** Visual overview of deployments / statefulsets / daemonsets / pods. Renders
 *  3-column cards with total + ready/notReady counts and a per-workload
 *  health bar. Clicking a card expands its `KubectlTable` in-place. The
 *  top-right global health bar pulses red when any workload has failures. */
/** Kind mapping from section key to singular K8s resource kind. */
const WORKLOAD_KIND_MAP: Record<string, string> = {
  deployments:  "deployment",
  statefulsets:  "statefulset",
  daemonsets:    "daemonset",
  replicasets:   "replicaset",
  jobs:          "job",
  cronjobs:      "cronjob",
};

export function WorkloadsTab({ data, target }: { data: Record<string, string>; target?: Target }) {
  const detail = useResourceDetail(target?.id ?? "");
  const readyColor: ColorFn = (val, col) => {
    if (col.toUpperCase() === "READY" || col.toUpperCase() === "AVAILABLE") {
      if (val.includes("0/") || val === "0") return C.status.danger;
    }
    return null;
  };

  const sections: WorkloadCounts[] = useMemo(() => [
    { label: "Deployments",  key: "deployments",  icon: <Rocket size={16} />,        color: C.accent.light, ...parseWorkloadCounts(data.deployments  ?? "", "Deployments")  },
    { label: "StatefulSets", key: "statefulsets", icon: <Database size={16} />,      color: C.status.info, ...parseWorkloadCounts(data.statefulsets ?? "", "StatefulSets") },
    { label: "DaemonSets",   key: "daemonsets",   icon: <RefreshCw size={16} />,     color: C.accent.soft, ...parseWorkloadCounts(data.daemonsets   ?? "", "DaemonSets")   },
    { label: "ReplicaSets",  key: "replicasets",  icon: <ClipboardList size={16} />, color: C.text.muted, ...parseWorkloadCounts(data.replicasets  ?? "", "ReplicaSets")  },
    { label: "Jobs",         key: "jobs",         icon: <Zap size={16} />,           color: C.status.warning, ...parseWorkloadCounts(data.jobs         ?? "", "Jobs")         },
    { label: "CronJobs",     key: "cronjobs",     icon: <Clock size={16} />,         color: "#22d3ee", ...parseWorkloadCounts(data.cronjobs     ?? "", "CronJobs")     },
  ], [data]);

  const totalAll  = sections.reduce((s, w) => s + w.total, 0);
  const readyAll  = sections.reduce((s, w) => s + w.ready, 0);
  const failedAll = sections.reduce((s, w) => s + w.notReady, 0);

  const [expanded, setExpanded] = useState<string>("deployments");

  return (
    <div style={{ overflowY: "auto", flex: 1, padding: 16 }}>
      {/* ── Summary bar ────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16, padding: "12px 16px", marginBottom: 16,
        background: C.bg.base, border: `1px solid ${C.border.subtle}`, borderRadius: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: C.text.primary }}>{totalAll}</span>
          <span style={{ fontSize: 12, color: C.text.muted }}>Total Workloads</span>
        </div>
        <div style={{ width: 1, height: 24, background: C.border.muted }} />
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.status.success, boxShadow: `0 0 6px ${C.status.success}88` }} />
          <span style={{ fontSize: 13, color: C.status.success, fontWeight: 700 }}>{readyAll}</span>
          <span style={{ fontSize: 11, color: C.text.muted }}>Ready</span>
        </div>
        {failedAll > 0 && (
          <>
            <div style={{ width: 1, height: 24, background: C.border.muted }} />
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.status.danger, boxShadow: `0 0 6px ${C.status.danger}88`, animation: "pulse 2s ease-in-out infinite" }} />
              <span style={{ fontSize: 13, color: C.status.danger, fontWeight: 700 }}>{failedAll}</span>
              <span style={{ fontSize: 11, color: C.text.muted }}>Not Ready</span>
            </div>
          </>
        )}
        {/* health bar */}
        <div style={{ flex: 1 }} />
        <div style={{ width: 120, height: 6, borderRadius: 3, background: C.border.subtle, overflow: "hidden", display: "flex" }}>
          {totalAll > 0 && (
            <>
              <div style={{ width: `${readyAll / totalAll * 100}%`, background: C.status.success, transition: "width .5s" }} />
              <div style={{
                width: `${failedAll / totalAll * 100}%`,
                background: C.status.danger,
                transition: "width .5s",
                animation: failedAll > 0 ? "pulse 2s ease-in-out infinite" : undefined,
              }} />
            </>
          )}
        </div>
      </div>

      {/* ── Resource type cards ────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
        {sections.map(s => {
          const isActive = expanded === s.key;
          const pct = s.total > 0 ? Math.round(s.ready / s.total * 100) : 100;
          const pctColor = s.notReady > 0 ? C.status.danger : C.status.success;
          return (
            <div
              key={s.key}
              onClick={() => setExpanded(isActive ? "" : s.key)}
              style={{
                background: isActive ? "#12162a" : C.bg.card,
                border: `1px solid ${isActive ? s.color + "66" : C.border.muted}`,
                borderRadius: 10, padding: "14px 16px", cursor: "pointer",
                transition: "all .15s", position: "relative", overflow: "hidden",
                boxShadow: isActive ? `0 0 20px ${s.color}15` : "none",
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = s.color + "44"; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = C.border.muted; }}
            >
              {/* top accent line */}
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: s.total > 0 ? s.color : C.border.muted }} />

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ color: s.color, display: "flex", alignItems: "center" }}>{s.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text.primary }}>{s.label}</span>
                <span style={{ marginLeft: "auto", color: C.text.faint, display: "flex", alignItems: "center" }}>{isActive ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
              </div>

              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: s.total > 0 ? s.color : C.text.faint, lineHeight: 1 }}>
                  {s.total}
                </span>
                {s.total > 0 && (
                  <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
                    <span style={{ color: C.status.success, display: "inline-flex", alignItems: "center", gap: 2 }}><Check size={11} /> {s.ready}</span>
                    {s.notReady > 0 && <span style={{ color: C.status.danger, display: "inline-flex", alignItems: "center", gap: 2 }}><XIcon size={11} /> {s.notReady}</span>}
                  </div>
                )}
              </div>

              {/* mini progress bar */}
              <div style={{ height: 3, borderRadius: 2, background: C.border.muted, overflow: "hidden" }}>
                {s.total > 0 && (
                  <div style={{ width: `${pct}%`, height: "100%", background: pctColor, transition: "width .4s" }} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Expanded detail table ──────────────────────────────────────── */}
      {expanded && (() => {
        const s = sections.find(s => s.key === expanded);
        if (!s) return null;
        const raw = data[s.key] ?? "";
        const hasData = hasKubectlData(raw);
        return (
          <div style={{
            background: C.bg.card, border: `1px solid ${C.border.muted}`, borderRadius: 10,
            overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,.3)",
          }}>
            <div style={{
              padding: "10px 16px", borderBottom: `1px solid ${C.border.muted}`,
              display: "flex", alignItems: "center", gap: 8,
              background: "#12141f",
            }}>
              <span style={{ fontSize: 14 }}>{s.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontSize: 11, color: C.text.muted }}>· {s.total} resource{s.total !== 1 ? "s" : ""}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              {hasData
                ? <KubectlTable
                    raw={raw}
                    colorFn={readyColor}
                    onRowClick={target ? (cols, headers) => {
                      const { name, ns } = extractResourceFromRow(cols, headers);
                      const kind = WORKLOAD_KIND_MAP[s.key] ?? s.key;
                      detail.open(kind, name, ns);
                    } : undefined}
                  />
                : <div style={{ padding: 20, color: C.text.faint, fontSize: 13 }}>No {s.label.toLowerCase()} found</div>
              }
            </div>
          </div>
        );
      })()}
      {(detail.resource || detail.loading) && (
        <ResourceModal resource={detail.resource} loading={detail.loading} targetId={target?.id ?? ""} onClose={detail.close} />
      )}
    </div>
  );
}

// ── K8s Storage tab ───────────────────────────────────────────────────────────

/** Kubernetes storage tab — PVCs, PVs, and StorageClasses in three sections.
 *  PVC/PV STATUS column is colorized via `pvStatusColorFn` (Bound/Pending/Lost). */
export function K8sStorageTab({ data, target }: { data: Record<string, string>; target?: Target }) {
  const detail = useResourceDetail(target?.id ?? "");

  const counts = useMemo(() => {
    const c = { bound: 0, pending: 0, lost: 0, pvcs: 0, pvs: 0, sc: 0 };
    const pvcRaw = data.pvcs ?? "";
    if (hasKubectlData(pvcRaw)) {
      for (const line of pvcRaw.split("\n").slice(1)) {
        if (!line.trim()) continue;
        c.pvcs++;
        if (/\bBound\b/.test(line)) c.bound++;
        else if (/\bPending\b/.test(line)) c.pending++;
        else if (/\bLost\b/.test(line)) c.lost++;
      }
    }
    const pvRaw = data.pvs ?? "";
    if (hasKubectlData(pvRaw))
      c.pvs = pvRaw.split("\n").slice(1).filter(l => l.trim()).length;
    const scRaw = data.storageclasses ?? "";
    if (hasKubectlData(scRaw))
      c.sc = scRaw.split("\n").slice(1).filter(l => l.trim()).length;
    return c;
  }, [data]);

  const pills = [
    { label: "PVCs",    count: counts.pvcs, color: C.accent.light, icon: <Package size={14} /> },
    { label: "PVs",     count: counts.pvs,  color: C.status.info, icon: <HardDrive size={14} /> },
    { label: "Classes", count: counts.sc,   color: C.text.muted, icon: <Tag size={14} /> },
  ];

  const statusPills = [
    { label: "Bound",   count: counts.bound,   color: C.status.success },
    { label: "Pending", count: counts.pending,  color: C.status.warning },
    { label: "Lost",    count: counts.lost,     color: C.status.danger },
  ];

  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      {/* summary */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        background: C.bg.panel, borderBottom: `1px solid ${C.border.subtle}`, flexShrink: 0, flexWrap: "wrap",
      }}>
        {pills.map(p => (
          <div key={p.label} style={{
            display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
            background: p.color + "15", border: `1px solid ${p.color}33`, borderRadius: 6,
          }}>
            <span style={{ fontSize: 11 }}>{p.icon}</span>
            <span style={{ fontSize: 12, color: p.color, fontWeight: 600 }}>{p.count}</span>
            <span style={{ fontSize: 11, color: C.text.secondary }}>{p.label}</span>
          </div>
        ))}
        {counts.pvcs > 0 && (
          <>
            <div style={{ width: 1, height: 20, background: C.border.muted }} />
            {statusPills.map(s => s.count > 0 && (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />
                <span style={{ fontSize: 11, color: s.color, fontWeight: 600 }}>{s.count}</span>
                <span style={{ fontSize: 10, color: C.text.muted }}>{s.label}</span>
              </div>
            ))}
          </>
        )}
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        <Card title="Persistent Volume Claims" hint={`${counts.pvcs}`} defaultOpen={true}>
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.pvcs ?? ""} colorFn={pvStatusColorFn} emptyMessage="No persistent volume claims"
            onRowClick={target ? (cols, headers) => { const { name, ns } = extractResourceFromRow(cols, headers); detail.open("pvc", name, ns); } : undefined}
          /></div>
        </Card>
        <Card title="Persistent Volumes" hint={`${counts.pvs}`} defaultOpen={false}>
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.pvs ?? ""} colorFn={pvStatusColorFn} emptyMessage="No persistent volumes"
            onRowClick={target ? (cols, headers) => { const { name, ns } = extractResourceFromRow(cols, headers); detail.open("pv", name, ns); } : undefined}
          /></div>
        </Card>
        <Card title="Storage Classes" hint={`${counts.sc}`} defaultOpen={false}>
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.storageclasses ?? ""} emptyMessage="No storage classes"
            onRowClick={target ? (cols, headers) => { const { name, ns } = extractResourceFromRow(cols, headers); detail.open("storageclass", name, ns); } : undefined}
          /></div>
        </Card>
      </div>
      {(detail.resource || detail.loading) && (
        <ResourceModal resource={detail.resource} loading={detail.loading} targetId={target?.id ?? ""} onClose={detail.close} />
      )}
    </div>
  );
}

// ── Ingress tab ───────────────────────────────────────────────────────────────

/** Kubernetes ingress tab — ingresses + ingress classes with summary pills. */
export function IngressTab({ data, target }: { data: Record<string, string>; target?: Target }) {
  const detail = useResourceDetail(target?.id ?? "");
  const counts = useMemo(() => {
    let ingresses = 0, classes = 0;
    const ingRaw = data.ingresses ?? "";
    if (hasKubectlData(ingRaw))
      ingresses = ingRaw.split("\n").slice(1).filter(l => l.trim()).length;
    const clsRaw = data.ingressclasses ?? "";
    if (hasKubectlData(clsRaw))
      classes = clsRaw.split("\n").slice(1).filter(l => l.trim()).length;
    return { ingresses, classes };
  }, [data]);

  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      {/* summary */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        background: C.bg.panel, borderBottom: `1px solid ${C.border.subtle}`, flexShrink: 0,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
          background: `${C.accent.light}15`, border: `1px solid ${C.accent.light}33`, borderRadius: 6,
        }}>
          <Globe size={11} />
          <span style={{ fontSize: 12, color: C.accent.light, fontWeight: 600 }}>{counts.ingresses}</span>
          <span style={{ fontSize: 11, color: C.text.secondary }}>Ingresses</span>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
          background: `${C.text.muted}15`, border: `1px solid ${C.text.muted}33`, borderRadius: 6,
        }}>
          <Tag size={11} />
          <span style={{ fontSize: 12, color: C.text.muted, fontWeight: 600 }}>{counts.classes}</span>
          <span style={{ fontSize: 11, color: C.text.secondary }}>Classes</span>
        </div>
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        <Card title="Ingresses" hint={`${counts.ingresses}`} defaultOpen={true}>
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.ingresses ?? ""} emptyMessage="No ingresses found"
            onRowClick={target ? (cols, headers) => { const { name, ns } = extractResourceFromRow(cols, headers); detail.open("ingress", name, ns); } : undefined}
          /></div>
        </Card>
        <Card title="Ingress Classes" hint={`${counts.classes}`} defaultOpen={false}>
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.ingressclasses ?? ""} emptyMessage="No ingress classes"
            onRowClick={target ? (cols, headers) => { const { name, ns } = extractResourceFromRow(cols, headers); detail.open("ingressclass", name, ns); } : undefined}
          /></div>
        </Card>
      </div>
      {(detail.resource || detail.loading) && (
        <ResourceModal resource={detail.resource} loading={detail.loading} targetId={target?.id ?? ""} onClose={detail.close} />
      )}
    </div>
  );
}

// ── Network tab ───────────────────────────────────────────────────────────────

/** Consolidated network view — services / ingresses / netpolicies / endpoints
 *  as collapsible Cards, plus pre-formatted ports/routes/interfaces/dns on
 *  ssh/local targets. */
/** Kind mapping from network section key to singular K8s resource kind. */
const NETWORK_KIND_MAP: Record<string, string> = {
  services:    "service",
  ingresses:   "ingress",
  netpolicies: "networkpolicy",
  endpoints:   "endpoints",
};

export function NetworkTab({ data, target }: { data: Record<string, string>; target?: Target }) {
  const detail = useResourceDetail(target?.id ?? "");

  const countLines = (raw?: string): number => {
    if (!raw || !hasKubectlData(raw)) return 0;
    return raw.split("\n").slice(1).filter(l => l.trim()).length;
  };

  const sections = useMemo(() => [
    { key: "services",    label: "Services",         icon: <Link2 size={14} /> as ReactNode, color: C.accent.light, count: countLines(data.services),    colorFn: serviceTypeColorFn, defaultOpen: true  },
    { key: "ingresses",   label: "Ingresses",        icon: <Globe size={14} /> as ReactNode, color: C.status.info, count: countLines(data.ingresses),   defaultOpen: false },
    { key: "netpolicies", label: "Network Policies",  icon: <Shield size={14} /> as ReactNode, color: C.accent.soft, count: countLines(data.netpolicies), defaultOpen: false },
    { key: "endpoints",   label: "Endpoints",         icon: <MapPin size={14} /> as ReactNode, color: C.text.muted, count: countLines(data.endpoints),   defaultOpen: false },
  ].filter(s => data[s.key]), [data]);

  const preItems = useMemo(() => [
    { key: "ports",      label: "Listening Ports", icon: <Plug size={14} /> as ReactNode },
    { key: "routes",     label: "Routes",          icon: <Map size={14} /> as ReactNode },
    { key: "interfaces", label: "Interfaces",      icon: <Radio size={14} /> as ReactNode },
    { key: "dns",        label: "DNS",             icon: <Search size={14} /> as ReactNode },
  ].filter(p => data[p.key]), [data]);

  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      {/* summary */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
        background: C.bg.panel, borderBottom: `1px solid ${C.border.subtle}`, flexShrink: 0, flexWrap: "wrap",
      }}>
        {sections.map(s => (
          <div key={s.key} style={{
            display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
            background: s.color + "15", border: `1px solid ${s.color}33`, borderRadius: 6,
          }}>
            <span style={{ fontSize: 11 }}>{s.icon}</span>
            <span style={{ fontSize: 12, color: s.color, fontWeight: 600 }}>{s.count}</span>
            <span style={{ fontSize: 11, color: C.text.secondary }}>{s.label}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {sections.map(s => (
          <Card key={s.key} title={s.label} hint={`${s.count}`} defaultOpen={s.defaultOpen}>
            <div style={{ overflowX: "auto" }}><KubectlTable raw={data[s.key] ?? ""} colorFn={s.colorFn} emptyMessage={`No ${s.label.toLowerCase()}`}
              onRowClick={target ? (cols, headers) => {
                const { name, ns } = extractResourceFromRow(cols, headers);
                const kind = NETWORK_KIND_MAP[s.key] ?? s.key;
                detail.open(kind, name, ns);
              } : undefined}
            /></div>
          </Card>
        ))}
        {preItems.map(p => (
          <Card key={p.key} title={`${p.icon} ${p.label}`} defaultOpen={p.key === "ports"}>
            <Pre>{data[p.key]}</Pre>
          </Card>
        ))}
      </div>
      {(detail.resource || detail.loading) && (
        <ResourceModal resource={detail.resource} loading={detail.loading} targetId={target?.id ?? ""} onClose={detail.close} />
      )}
    </div>
  );
}

// ── Docker tabs ───────────────────────────────────────────────────────────────

/** Docker `ps -a` view with running/exited/paused pill counts. Column set is
 *  controlled by `DOCKER_PS_FORMAT` in `ui/web.py`. */
export function DockerContainersTab({ data, target }: { data: Record<string, string>; target?: Target }) {
  const detail = useResourceDetail(target?.id ?? "");
  const raw = data.output ?? "";
  const colorFn: ColorFn = (val, col) => {
    if (col.toUpperCase() === "STATUS") {
      if (/^Up/i.test(val))    return C.status.success;
      if (/Exited/i.test(val)) return C.status.danger;
      if (/Paused/i.test(val)) return C.status.warning;
    }
    return null;
  };
  const counts = useMemo(() => {
    let up = 0, exited = 0, paused = 0, total = 0;
    if (hasKubectlData(raw)) {
      for (const line of raw.split("\n").slice(1)) {
        if (!line.trim()) continue;
        total++;
        if (/\bUp\b/i.test(line)) up++;
        else if (/Exited/i.test(line)) exited++;
        else if (/Paused/i.test(line)) paused++;
      }
    }
    return { up, exited, paused, total };
  }, [raw]);
  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        background: C.bg.panel, borderBottom: `1px solid ${C.border.subtle}`, flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text.primary }}>{counts.total} Containers</span>
        <div style={{ width: 1, height: 20, background: C.border.muted }} />
        {counts.up > 0 && <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.status.success }} />
          <span style={{ fontSize: 12, color: C.status.success, fontWeight: 600 }}>{counts.up}</span>
          <span style={{ fontSize: 11, color: C.text.muted }}>Running</span>
        </div>}
        {counts.exited > 0 && <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.status.danger, animation: "pulse 2s ease-in-out infinite" }} />
          <span style={{ fontSize: 12, color: C.status.danger, fontWeight: 600 }}>{counts.exited}</span>
          <span style={{ fontSize: 11, color: C.text.muted }}>Exited</span>
        </div>}
        {counts.paused > 0 && <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.status.warning }} />
          <span style={{ fontSize: 12, color: C.status.warning, fontWeight: 600 }}>{counts.paused}</span>
          <span style={{ fontSize: 11, color: C.text.muted }}>Paused</span>
        </div>}
      </div>
      <KubectlTable raw={raw} colorFn={colorFn} emptyMessage="No containers running"
        onRowClick={target ? (cols, headers) => {
          const nameIdx = headers.findIndex(h => h.toUpperCase() === 'NAMES' || h.toUpperCase() === 'NAME');
          const name = nameIdx >= 0 ? cols[nameIdx] : cols[0] ?? '';
          detail.open("container", name, "");
        } : undefined}
      />
      {(detail.resource || detail.loading) && (
        <ResourceModal resource={detail.resource} loading={detail.loading} targetId={target?.id ?? ""} onClose={detail.close} />
      )}
    </div>
  );
}

/** Docker volumes listing — `docker volume ls` output with a count pill. */
export function DockerVolumesTab({ data, target }: { data: Record<string, string>; target?: Target }) {
  const detail = useResourceDetail(target?.id ?? "");
  const raw = data.output ?? "";
  const count = useMemo(() => {
    if (!hasKubectlData(raw)) return 0;
    return raw.split("\n").slice(1).filter(l => l.trim()).length;
  }, [raw]);
  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
        background: C.bg.panel, borderBottom: `1px solid ${C.border.subtle}`, flexShrink: 0,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
          background: `${C.accent.light}15`, border: `1px solid ${C.accent.light}33`, borderRadius: 6,
        }}>
          <HardDrive size={11} />
          <span style={{ fontSize: 12, color: C.accent.light, fontWeight: 600 }}>{count}</span>
          <span style={{ fontSize: 11, color: C.text.secondary }}>Volumes</span>
        </div>
      </div>
      <KubectlTable raw={raw} emptyMessage="No Docker volumes"
        onRowClick={target ? (cols, headers) => {
          const { name } = extractResourceFromRow(cols, headers);
          detail.open("volume", name, "");
        } : undefined}
      />
      {(detail.resource || detail.loading) && (
        <ResourceModal resource={detail.resource} loading={detail.loading} targetId={target?.id ?? ""} onClose={detail.close} />
      )}
    </div>
  );
}

/** Docker images listing — `docker images` output with a count pill. */
export function DockerImagesTab({ data, target }: { data: Record<string, string>; target?: Target }) {
  const detail = useResourceDetail(target?.id ?? "");
  const raw = data.output ?? "";
  const count = useMemo(() => {
    if (!hasKubectlData(raw)) return 0;
    return raw.split("\n").slice(1).filter(l => l.trim()).length;
  }, [raw]);
  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
        background: C.bg.panel, borderBottom: `1px solid ${C.border.subtle}`, flexShrink: 0,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
          background: `${C.status.info}15`, border: `1px solid ${C.status.info}33`, borderRadius: 6,
        }}>
          <Package size={11} />
          <span style={{ fontSize: 12, color: C.status.info, fontWeight: 600 }}>{count}</span>
          <span style={{ fontSize: 11, color: C.text.secondary }}>Images</span>
        </div>
      </div>
      <KubectlTable raw={raw} emptyMessage="No Docker images"
        onRowClick={target ? (cols, headers) => {
          const { name } = extractResourceFromRow(cols, headers);
          detail.open("image", name, "");
        } : undefined}
      />
      {(detail.resource || detail.loading) && (
        <ResourceModal resource={detail.resource} loading={detail.loading} targetId={target?.id ?? ""} onClose={detail.close} />
      )}
    </div>
  );
}

/** Docker stats snapshot — CPU% and MEM% colorized via threshold ColorFn
 *  (green < 50%, amber < 80%, red ≥ 80%). Not live-streaming; one snapshot
 *  per tab reload. */
export function DockerStatsTab({ data, target }: { data: Record<string, string>; target?: Target }) {
  const detail = useResourceDetail(target?.id ?? "");
  const raw = data.output ?? "";
  const colorFn: ColorFn = (val, col) => {
    const upper = col.toUpperCase();
    if (upper === "CPU %" || upper === "MEM %") {
      const pct = parseFloat(val);
      if (pct > 80) return C.status.danger;
      if (pct > 50) return C.status.warning;
      if (pct > 0)  return C.status.success;
    }
    return null;
  };
  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
        background: C.bg.panel, borderBottom: `1px solid ${C.border.subtle}`, flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text.primary, display: "inline-flex", alignItems: "center", gap: 6 }}><BarChart3 size={14} /> Container Stats</span>
        <span style={{ fontSize: 11, color: C.text.faint }}>CPU & memory usage (live snapshot)</span>
      </div>
      <KubectlTable raw={raw} colorFn={colorFn} emptyMessage="No container stats available"
        onRowClick={target ? (cols, headers) => {
          const nameIdx = headers.findIndex(h => h.toUpperCase() === 'NAME' || h.toUpperCase() === 'CONTAINER');
          const name = nameIdx >= 0 ? cols[nameIdx] : cols[0] ?? '';
          detail.open("container", name, "");
        } : undefined}
      />
      {(detail.resource || detail.loading) && (
        <ResourceModal resource={detail.resource} loading={detail.loading} targetId={target?.id ?? ""} onClose={detail.close} />
      )}
    </div>
  );
}

// ── SSH Services tab ──────────────────────────────────────────────────────────

/** Parse systemctl service status counts from `systemctl list-units` output.
 *  Each data line is scanned for `active running`, `failed`, and `active exited`. */
function parseServiceCounts(raw: string): { running: number; failed: number; exited: number; total: number } {
  let running = 0, failed = 0, exited = 0, total = 0;
  const lines = raw.split("\n").slice(1).filter(l => l.trim()); // skip header
  for (const line of lines) {
    if (!line.trim()) continue;
    total++;
    if (/\bactive\b.*\brunning\b/i.test(line)) running++;
    else if (/\bfailed\b/i.test(line)) failed++;
    else if (/\bactive\b.*\bexited\b/i.test(line)) exited++;
  }
  return { running, failed, exited, total };
}

/** SSH/local target services tab.
 *  Shows a summary bar with running / failed / exited counts, then collapsible
 *  cards for Failed Services, All Services, and Scheduled Timers. Clicking a
 *  row opens `ResourceModal` (systemctl status + journalctl). */
export function SSHServicesTab({ data, target }: { data: Record<string, string>; target?: Target }) {
  const detail = useResourceDetail(target?.id ?? "");

  const counts = useMemo(() => parseServiceCounts(data.all ?? ""), [data.all]);

  const serviceColorFn: ColorFn = (val, col) => {
    if (col.toUpperCase() === "SUB") {
      if (val === "running") return C.status.success;
      if (val === "failed")  return C.status.danger;
      if (val === "exited")  return C.status.warning;
      if (val === "dead")    return C.text.muted;
    }
    return null;
  };

  const failedHasContent = !!(data.failed ?? "").trim();

  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      {/* TIER 1 — Summary bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        background: C.bg.panel, borderBottom: `1px solid ${C.border.subtle}`, flexShrink: 0,
      }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: C.text.primary, lineHeight: 1 }}>{counts.total}</span>
        <span style={{ fontSize: 12, color: C.text.muted }}>Services</span>
        <div style={{ width: 1, height: 20, background: C.border.muted }} />

        {counts.running > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.status.success, boxShadow: `0 0 5px ${C.status.success}88` }} />
            <span style={{ fontSize: 12, color: C.status.success, fontWeight: 600 }}>{counts.running}</span>
            <span style={{ fontSize: 11, color: C.text.muted }}>Running</span>
          </div>
        )}
        {counts.failed > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.status.danger, animation: "pulse 2s ease-in-out infinite" }} />
            <span style={{ fontSize: 12, color: C.status.danger, fontWeight: 600 }}>{counts.failed}</span>
            <span style={{ fontSize: 11, color: C.text.muted }}>Failed</span>
          </div>
        )}
        {counts.exited > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.status.warning }} />
            <span style={{ fontSize: 12, color: C.status.warning, fontWeight: 600 }}>{counts.exited}</span>
            <span style={{ fontSize: 11, color: C.text.muted }}>Exited</span>
          </div>
        )}

        {/* health bar */}
        {counts.total > 0 && (
          <>
            <div style={{ flex: 1 }} />
            <div style={{ width: 120, height: 6, borderRadius: 3, background: C.border.subtle, overflow: "hidden", display: "flex" }}>
              <div style={{ width: `${counts.running / counts.total * 100}%`, background: C.status.success, transition: "width .5s" }} />
              <div style={{ width: `${counts.failed / counts.total * 100}%`, background: C.status.danger, transition: "width .5s" }} />
              <div style={{ width: `${counts.exited / counts.total * 100}%`, background: C.status.warning, transition: "width .5s" }} />
            </div>
          </>
        )}
      </div>

      {/* TIER 2 — Cards */}
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        <Card title={`Failed Services (${counts.failed})`} defaultOpen={counts.failed > 0}>
          {failedHasContent
            ? <div style={{ overflowX: "auto" }}><KubectlTable raw={data.failed ?? ""} emptyMessage="No failed services" /></div>
            : <div style={{ color: C.status.success, fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
                All services healthy <Check size={13} />
              </div>
          }
        </Card>

        <Card title="All Services" defaultOpen={true}>
          <div style={{ overflowX: "auto" }}>
            <KubectlTable
              raw={data.all ?? ""}
              colorFn={serviceColorFn}
              emptyMessage="No services found"
              onRowClick={(cols) => {
                const unitName = cols[0] ?? "";
                if (unitName) detail.open("service", unitName, "");
              }}
            />
          </div>
        </Card>

        <Card title="Scheduled Timers" defaultOpen={false}>
          <div style={{ overflowX: "auto" }}>
            <KubectlTable raw={data.timers ?? ""} emptyMessage="No scheduled timers" />
          </div>
        </Card>
      </div>

      {/* TIER 3 — ResourceModal */}
      {(detail.resource || detail.loading) && (
        <ResourceModal resource={detail.resource} loading={detail.loading} targetId={target?.id ?? ""} onClose={detail.close} />
      )}
    </div>
  );
}

// ── Processes tab ─────────────────────────────────────────────────────────────

/** Colorize CPU or MEM percentage columns: >50% → danger, >20% → warning, >0% → success. */
const pctColorFn: ColorFn = (val) => {
  const n = parseFloat(val);
  if (isNaN(n)) return null;
  if (n > 50) return C.status.danger;
  if (n > 20) return C.status.warning;
  if (n > 0)  return C.status.success;
  return null;
};

/** Extract the last whitespace-delimited token from a line (used for COMMAND). */
function lastToken(line: string): string {
  return line.trim().split(/\s+/).pop() ?? "";
}

/** SSH/local target processes tab.
 *  Shows a 4-card metric row (load average, total processes, top CPU, top MEM)
 *  followed by two collapsible tables. */
export function ProcessesTab({ data }: { data: Record<string, string> }) {
  const loadMatch = (data.load ?? "").match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  const load1  = loadMatch ? parseFloat(loadMatch[1]) : null;
  const load5  = loadMatch ? loadMatch[2] : "—";
  const load15 = loadMatch ? loadMatch[3] : "—";
  const loadColor = load1 === null ? C.text.muted : load1 >= 4.0 ? C.status.danger : load1 >= 2.0 ? C.status.warning : C.status.success;

  const totalProcs = parseInt(data.count ?? "0") || 0;

  // First data line from top_cpu (skip header)
  const cpuLines = (data.top_cpu ?? "").split("\n").filter(l => l.trim());
  const cpuDataLine = cpuLines.length > 1 ? cpuLines[1] : "";
  const cpuCols = cpuDataLine.trim().split(/\s+/);
  const topCpuCmd = lastToken(cpuDataLine);
  const topCpuPct = cpuCols[2] ?? "—"; // %CPU is typically col index 2 in `ps` output

  const memLines = (data.top_mem ?? "").split("\n").filter(l => l.trim());
  const memDataLine = memLines.length > 1 ? memLines[1] : "";
  const memCols = memDataLine.trim().split(/\s+/);
  const topMemCmd = lastToken(memDataLine);
  const topMemPct = memCols[3] ?? "—"; // %MEM is typically col index 3 in `ps` output

  const cpuPctNum = parseFloat(topCpuPct);
  const memPctNum = parseFloat(topMemPct);
  const cpuStatColor = isNaN(cpuPctNum) ? C.text.muted : cpuPctNum > 50 ? C.status.danger : cpuPctNum > 20 ? C.status.warning : C.status.success;
  const memStatColor = isNaN(memPctNum) ? C.text.muted : memPctNum > 50 ? C.status.danger : memPctNum > 20 ? C.status.warning : C.status.success;

  const metricCardStyle = {
    background: C.bg.card,
    border: `1px solid ${C.border.muted}`,
    borderRadius: 10,
    padding: "14px 16px",
    flex: 1,
    minWidth: 0,
  } as const;

  return (
    <div style={{ overflowY: "auto", flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* TIER 1 — Metric cards row */}
      <div style={{ display: "flex", gap: 12 }}>
        {/* Load Average */}
        <div style={metricCardStyle}>
          <div style={{ fontSize: 10, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>Load Average</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: loadColor, lineHeight: 1 }}>
            {load1 !== null ? load1.toFixed(2) : "—"}
          </div>
          <div style={{ fontSize: 11, color: C.text.faint, marginTop: 4 }}>
            5m: {load5} · 15m: {load15}
          </div>
        </div>

        {/* Total Processes */}
        <div style={metricCardStyle}>
          <div style={{ fontSize: 10, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>Total Processes</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.accent.light, lineHeight: 1 }}>{totalProcs}</div>
          <div style={{ fontSize: 11, color: C.text.faint, marginTop: 4 }}>active processes</div>
        </div>

        {/* Top CPU */}
        <div style={metricCardStyle}>
          <div style={{ fontSize: 10, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>Top CPU Consumer</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: cpuStatColor, lineHeight: 1 }}>{topCpuPct}%</div>
          <div style={{ fontSize: 11, color: C.text.faint, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {topCpuCmd || "—"}
          </div>
        </div>

        {/* Top Memory */}
        <div style={metricCardStyle}>
          <div style={{ fontSize: 10, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>Top Memory Consumer</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: memStatColor, lineHeight: 1 }}>{topMemPct}%</div>
          <div style={{ fontSize: 11, color: C.text.faint, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {topMemCmd || "—"}
          </div>
        </div>
      </div>

      {/* TIER 2 — Tables */}
      <Card title="Top CPU Consumers" defaultOpen={true}>
        <div style={{ overflowX: "auto" }}>
          <KubectlTable raw={data.top_cpu ?? ""} colorFn={pctColorFn} emptyMessage="No process data" />
        </div>
      </Card>
      <Card title="Top Memory Consumers" defaultOpen={true}>
        <div style={{ overflowX: "auto" }}>
          <KubectlTable raw={data.top_mem ?? ""} colorFn={pctColorFn} emptyMessage="No process data" />
        </div>
      </Card>
    </div>
  );
}

// ── Security tab ──────────────────────────────────────────────────────────────

/** Detect firewall status from raw firewall output.
 *  Supports ufw ("Status: active"), iptables (has "Chain"), or none. */
function detectFirewallStatus(raw: string): { label: string; color: string } {
  if (!raw || !raw.trim()) return { label: "Not Detected", color: C.status.warning };
  if (/Status:\s*active/i.test(raw)) return { label: "Active", color: C.status.success };
  if (/\bChain\b/.test(raw)) return { label: "Active", color: C.status.success };
  if (/Status:\s*inactive/i.test(raw)) return { label: "Inactive", color: C.status.danger };
  return { label: "Not Detected", color: C.status.warning };
}

/** Count non-empty lines in a block of text. */
function countLines(raw: string): number {
  return (raw ?? "").split("\n").filter(l => l.trim()).length;
}

/** SSH/local target security tab.
 *  Shows a summary bar (active users, recent logins, failed attempts, firewall
 *  status) then collapsible cards for each data source. */
export function SecurityTab({ data }: { data: Record<string, string> }) {
  const activeUserCount  = useMemo(() => countLines(data.active_users ?? ""), [data.active_users]);
  const recentLoginCount = useMemo(() => countLines(data.last_logins ?? ""), [data.last_logins]);
  const failedCount      = useMemo(() => countLines(data.failed_logins ?? ""), [data.failed_logins]);
  const firewall         = useMemo(() => detectFirewallStatus(data.firewall ?? ""), [data.firewall]);

  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      {/* TIER 1 — Summary bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", flexWrap: "wrap",
        background: C.bg.panel, borderBottom: `1px solid ${C.border.subtle}`, flexShrink: 0,
      }}>
        {/* Label */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 4 }}>
          <Shield size={14} stroke={C.accent.light} />
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text.primary }}>Security Overview</span>
        </div>
        <div style={{ width: 1, height: 20, background: C.border.muted }} />

        {/* Active users pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", background: `${C.accent.light}15`, border: `1px solid ${C.accent.light}33`, borderRadius: 6 }}>
          <Users size={11} stroke={C.accent.light} />
          <span style={{ fontSize: 12, color: C.accent.light, fontWeight: 600 }}>{activeUserCount}</span>
          <span style={{ fontSize: 11, color: C.text.secondary }}>Active Users</span>
        </div>

        {/* Recent logins pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", background: `${C.status.info}15`, border: `1px solid ${C.status.info}33`, borderRadius: 6 }}>
          <FileText size={11} stroke={C.status.info} />
          <span style={{ fontSize: 12, color: C.status.info, fontWeight: 600 }}>{recentLoginCount}</span>
          <span style={{ fontSize: 11, color: C.text.secondary }}>Recent Logins</span>
        </div>

        {/* Failed attempts pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", background: `${C.status.danger}15`, border: `1px solid ${C.status.danger}33`, borderRadius: 6 }}>
          <AlertTriangle size={11} stroke={C.status.danger} style={failedCount > 0 ? { animation: "pulse 2s ease-in-out infinite" } : undefined} />
          <span style={{ fontSize: 12, color: C.status.danger, fontWeight: 600 }}>{failedCount}</span>
          <span style={{ fontSize: 11, color: C.text.secondary }}>Failed Attempts</span>
        </div>

        {/* Firewall status pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", background: `${firewall.color}15`, border: `1px solid ${firewall.color}33`, borderRadius: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: firewall.color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: firewall.color, fontWeight: 600 }}>Firewall</span>
          <span style={{ fontSize: 11, color: C.text.secondary }}>{firewall.label}</span>
        </div>
      </div>

      {/* TIER 2 — Cards */}
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        <Card title="Active Users" defaultOpen={true}>
          <Pre>{data.active_users ?? "No data"}</Pre>
        </Card>

        <Card title="Recent Logins" defaultOpen={true}>
          <Pre>{data.last_logins ?? "No data"}</Pre>
        </Card>

        <Card title={`Failed SSH Attempts (${failedCount})`} defaultOpen={failedCount > 0}>
          {failedCount > 0
            ? <div style={{ background: `${C.status.danger}08`, borderRadius: 6, padding: 8 }}>
                <Pre>{data.failed_logins ?? ""}</Pre>
              </div>
            : <Pre>{data.failed_logins ?? "No failed login attempts"}</Pre>
          }
        </Card>

        <Card title="Firewall Rules" defaultOpen={false}>
          <Pre>{data.firewall ?? "No firewall data"}</Pre>
        </Card>
      </div>
    </div>
  );
}
