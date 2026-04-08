/**
 * dashboard/tabs.tsx — per-tab content components extracted from Dashboard.tsx.
 */
import { useState, useMemo } from 'react';
import { RingChart, Card, Pre } from './primitives';
import { KubectlTable, hasKubectlData, serviceTypeColorFn, pvStatusColorFn, type ColorFn } from './tables';

// ── Overview metric cards ─────────────────────────────────────────────────────

export function OverviewTab({ data }: { data: Record<string, string> }) {
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

  const pctColor  = (p: number) => p > 80 ? "#ef4444" : p > 60 ? "#f59e0b" : "#22c55e";
  const fillColor = (p: number) => p > 80 ? "#ef4444" : p > 60 ? "#f59e0b" : "#22c55e";

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
          <div key={card.label} style={{ background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 10, padding: 16, boxShadow: "0 4px 16px rgba(0,0,0,.35)", display: "flex", alignItems: "center", gap: 14 }}>
            {card.pct >= 0
              ? <RingChart pct={card.pct} color={fillColor(card.pct)} size={52} />
              : <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#6366f118", border: "2px solid #6366f133", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </div>
            }
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>{card.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: card.pct >= 0 ? pctColor(card.pct) : "#7c8cf8", lineHeight: 1 }}>{card.val}</div>
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* failed services + top procs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Card title={`Failed Services (${failed.length})`}>
          {failed.length === 0
            ? <div style={{ color: "#22c55e", fontSize: 13 }}>All services healthy ✓</div>
            : failed.map((s, i) => <div key={i} style={{ fontSize: 13, color: "#ef4444", marginBottom: 3 }}>• {s}</div>)
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

export function GenericTab({ data }: { data: Record<string, string> }) {
  if (data.error) return <div style={{ padding: 20, color: "#ef4444" }}>{data.error}</div>;
  const entries = Object.entries(data);
  if (!entries.length) return <div style={{ padding: 20, color: "#64748b" }}>No data</div>;
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

export function EventsTab({ data }: { data: Record<string, string> }) {
  const raw = data.output ?? "";
  const colorFn: ColorFn = (val, col) => {
    if (col.toUpperCase() === "TYPE") {
      if (val === "Warning") return "#f59e0b";
      if (val === "Normal")  return "#22c55e";
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
        background: "#0b0d14", borderBottom: "1px solid #1e2235", flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{counts.total} Events</span>
        <div style={{ width: 1, height: 20, background: "#2d3148" }} />
        {counts.warning > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f59e0b", animation: "pulse 2s ease-in-out infinite" }} />
            <span style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>{counts.warning}</span>
            <span style={{ fontSize: 11, color: "#64748b" }}>Warning</span>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e" }} />
          <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 600 }}>{counts.normal}</span>
          <span style={{ fontSize: 11, color: "#64748b" }}>Normal</span>
        </div>
        {counts.total > 0 && (
          <>
            <div style={{ flex: 1 }} />
            <div style={{ width: 80, height: 5, borderRadius: 3, background: "#1e2235", overflow: "hidden", display: "flex" }}>
              <div style={{ width: `${counts.normal / counts.total * 100}%`, background: "#22c55e" }} />
              <div style={{ width: `${counts.warning / counts.total * 100}%`, background: "#f59e0b" }} />
            </div>
          </>
        )}
      </div>
      <KubectlTable raw={raw} colorFn={colorFn} emptyMessage="No events in this namespace" />
    </div>
  );
}

// ── Services tab ──────────────────────────────────────────────────────────────

export function ServicesTab({ data }: { data: Record<string, string> }) {
  const raw = data.services ?? "";
  const colorFn = serviceTypeColorFn;

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
    { label: "LoadBalancer", count: counts.lb,  color: "#818cf8", icon: "🌐" },
    { label: "NodePort",     count: counts.np,  color: "#06b6d4", icon: "🔗" },
    { label: "ClusterIP",    count: counts.cip, color: "#64748b", icon: "🔒" },
    { label: "ExternalName", count: counts.ext, color: "#f59e0b", icon: "↗" },
  ];

  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      {/* summary */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        background: "#0b0d14", borderBottom: "1px solid #1e2235", flexShrink: 0, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{counts.total} Services</span>
        <div style={{ width: 1, height: 20, background: "#2d3148" }} />
        {pills.map(p => p.count > 0 && (
          <div key={p.label} style={{
            display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
            background: p.color + "15", border: `1px solid ${p.color}33`, borderRadius: 6,
          }}>
            <span style={{ fontSize: 11 }}>{p.icon}</span>
            <span style={{ fontSize: 12, color: p.color, fontWeight: 600 }}>{p.count}</span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>{p.label}</span>
          </div>
        ))}
      </div>
      <KubectlTable raw={raw} colorFn={colorFn} emptyMessage="No services found" />
    </div>
  );
}

// ── Workloads tab — visual overview with count cards + detail tables ──────────

interface WorkloadCounts {
  label:    string;
  key:      string;
  icon:     string;
  color:    string;
  total:    number;
  ready:    number;
  notReady: number;
}

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

export function WorkloadsTab({ data }: { data: Record<string, string> }) {
  const readyColor: ColorFn = (val, col) => {
    if (col.toUpperCase() === "READY" || col.toUpperCase() === "AVAILABLE") {
      if (val.includes("0/") || val === "0") return "#ef4444";
    }
    return null;
  };

  const sections: WorkloadCounts[] = useMemo(() => [
    { label: "Deployments",  key: "deployments",  icon: "🚀", color: "#818cf8", ...parseWorkloadCounts(data.deployments  ?? "", "Deployments")  },
    { label: "StatefulSets", key: "statefulsets", icon: "🗄",  color: "#06b6d4", ...parseWorkloadCounts(data.statefulsets ?? "", "StatefulSets") },
    { label: "DaemonSets",   key: "daemonsets",   icon: "🔁", color: "#a78bfa", ...parseWorkloadCounts(data.daemonsets   ?? "", "DaemonSets")   },
    { label: "ReplicaSets",  key: "replicasets",  icon: "📋", color: "#64748b", ...parseWorkloadCounts(data.replicasets  ?? "", "ReplicaSets")  },
    { label: "Jobs",         key: "jobs",         icon: "⚡", color: "#f59e0b", ...parseWorkloadCounts(data.jobs         ?? "", "Jobs")         },
    { label: "CronJobs",     key: "cronjobs",     icon: "🕐", color: "#22d3ee", ...parseWorkloadCounts(data.cronjobs     ?? "", "CronJobs")     },
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
        background: "#0d1117", border: "1px solid #1e2235", borderRadius: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: "#e2e8f0" }}>{totalAll}</span>
          <span style={{ fontSize: 12, color: "#64748b" }}>Total Workloads</span>
        </div>
        <div style={{ width: 1, height: 24, background: "#2d3148" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e88" }} />
          <span style={{ fontSize: 13, color: "#22c55e", fontWeight: 700 }}>{readyAll}</span>
          <span style={{ fontSize: 11, color: "#64748b" }}>Ready</span>
        </div>
        {failedAll > 0 && (
          <>
            <div style={{ width: 1, height: 24, background: "#2d3148" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 6px #ef444488", animation: "pulse 2s ease-in-out infinite" }} />
              <span style={{ fontSize: 13, color: "#ef4444", fontWeight: 700 }}>{failedAll}</span>
              <span style={{ fontSize: 11, color: "#64748b" }}>Not Ready</span>
            </div>
          </>
        )}
        {/* health bar */}
        <div style={{ flex: 1 }} />
        <div style={{ width: 120, height: 6, borderRadius: 3, background: "#1e2235", overflow: "hidden", display: "flex" }}>
          {totalAll > 0 && (
            <>
              <div style={{ width: `${readyAll / totalAll * 100}%`, background: "#22c55e", transition: "width .5s" }} />
              <div style={{
                width: `${failedAll / totalAll * 100}%`,
                background: "#ef4444",
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
          const pctColor = s.notReady > 0 ? "#ef4444" : "#22c55e";
          return (
            <div
              key={s.key}
              onClick={() => setExpanded(isActive ? "" : s.key)}
              style={{
                background: isActive ? "#12162a" : "#1a1d27",
                border: `1px solid ${isActive ? s.color + "66" : "#2d3148"}`,
                borderRadius: 10, padding: "14px 16px", cursor: "pointer",
                transition: "all .15s", position: "relative", overflow: "hidden",
                boxShadow: isActive ? `0 0 20px ${s.color}15` : "none",
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = s.color + "44"; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = "#2d3148"; }}
            >
              {/* top accent line */}
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: s.total > 0 ? s.color : "#2d3148" }} />

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>{s.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{s.label}</span>
                <span style={{ marginLeft: "auto", fontSize: 10, color: "#475569" }}>{isActive ? "▼" : "▶"}</span>
              </div>

              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: s.total > 0 ? s.color : "#475569", lineHeight: 1 }}>
                  {s.total}
                </span>
                {s.total > 0 && (
                  <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
                    <span style={{ color: "#22c55e" }}>✓ {s.ready}</span>
                    {s.notReady > 0 && <span style={{ color: "#ef4444" }}>✗ {s.notReady}</span>}
                  </div>
                )}
              </div>

              {/* mini progress bar */}
              <div style={{ height: 3, borderRadius: 2, background: "#2d3148", overflow: "hidden" }}>
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
            background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 10,
            overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,.3)",
          }}>
            <div style={{
              padding: "10px 16px", borderBottom: "1px solid #2d3148",
              display: "flex", alignItems: "center", gap: 8,
              background: "#12141f",
            }}>
              <span style={{ fontSize: 14 }}>{s.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontSize: 11, color: "#64748b" }}>· {s.total} resource{s.total !== 1 ? "s" : ""}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              {hasData
                ? <KubectlTable raw={raw} colorFn={readyColor} />
                : <div style={{ padding: 20, color: "#475569", fontSize: 13 }}>No {s.label.toLowerCase()} found</div>
              }
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── K8s Storage tab ───────────────────────────────────────────────────────────

export function K8sStorageTab({ data }: { data: Record<string, string> }) {
  const pvcColor = pvStatusColorFn;

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
    { label: "PVCs",    count: counts.pvcs, color: "#818cf8", icon: "📦" },
    { label: "PVs",     count: counts.pvs,  color: "#06b6d4", icon: "💾" },
    { label: "Classes", count: counts.sc,   color: "#64748b", icon: "🏷" },
  ];

  const statusPills = [
    { label: "Bound",   count: counts.bound,   color: "#22c55e" },
    { label: "Pending", count: counts.pending,  color: "#f59e0b" },
    { label: "Lost",    count: counts.lost,     color: "#ef4444" },
  ];

  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      {/* summary */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        background: "#0b0d14", borderBottom: "1px solid #1e2235", flexShrink: 0, flexWrap: "wrap",
      }}>
        {pills.map(p => (
          <div key={p.label} style={{
            display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
            background: p.color + "15", border: `1px solid ${p.color}33`, borderRadius: 6,
          }}>
            <span style={{ fontSize: 11 }}>{p.icon}</span>
            <span style={{ fontSize: 12, color: p.color, fontWeight: 600 }}>{p.count}</span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>{p.label}</span>
          </div>
        ))}
        {counts.pvcs > 0 && (
          <>
            <div style={{ width: 1, height: 20, background: "#2d3148" }} />
            {statusPills.map(s => s.count > 0 && (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />
                <span style={{ fontSize: 11, color: s.color, fontWeight: 600 }}>{s.count}</span>
                <span style={{ fontSize: 10, color: "#64748b" }}>{s.label}</span>
              </div>
            ))}
          </>
        )}
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        <Card title="Persistent Volume Claims" hint={`${counts.pvcs}`} defaultOpen={true}>
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.pvcs ?? ""} colorFn={pvcColor} emptyMessage="No persistent volume claims" /></div>
        </Card>
        <Card title="Persistent Volumes" hint={`${counts.pvs}`} defaultOpen={false}>
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.pvs ?? ""} colorFn={pvcColor} emptyMessage="No persistent volumes" /></div>
        </Card>
        <Card title="Storage Classes" hint={`${counts.sc}`} defaultOpen={false}>
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.storageclasses ?? ""} emptyMessage="No storage classes" /></div>
        </Card>
      </div>
    </div>
  );
}

// ── Ingress tab ───────────────────────────────────────────────────────────────

export function IngressTab({ data }: { data: Record<string, string> }) {
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
        background: "#0b0d14", borderBottom: "1px solid #1e2235", flexShrink: 0,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
          background: "#818cf815", border: "1px solid #818cf833", borderRadius: 6,
        }}>
          <span style={{ fontSize: 11 }}>🌐</span>
          <span style={{ fontSize: 12, color: "#818cf8", fontWeight: 600 }}>{counts.ingresses}</span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>Ingresses</span>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
          background: "#64748b15", border: "1px solid #64748b33", borderRadius: 6,
        }}>
          <span style={{ fontSize: 11 }}>🏷</span>
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{counts.classes}</span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>Classes</span>
        </div>
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        <Card title="Ingresses" hint={`${counts.ingresses}`} defaultOpen={true}>
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.ingresses ?? ""} emptyMessage="No ingresses found" /></div>
        </Card>
        <Card title="Ingress Classes" hint={`${counts.classes}`} defaultOpen={false}>
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.ingressclasses ?? ""} emptyMessage="No ingress classes" /></div>
        </Card>
      </div>
    </div>
  );
}

// ── Network tab ───────────────────────────────────────────────────────────────

export function NetworkTab({ data }: { data: Record<string, string> }) {
  const svcColor = serviceTypeColorFn;

  const countLines = (raw?: string) => {
    if (!hasKubectlData(raw)) return 0;
    return raw!.split("\n").slice(1).filter(l => l.trim()).length;
  };

  const sections = useMemo(() => [
    { key: "services",    label: "Services",         icon: "🔗", color: "#818cf8", count: countLines(data.services),    colorFn: svcColor, defaultOpen: true  },
    { key: "ingresses",   label: "Ingresses",        icon: "🌐", color: "#06b6d4", count: countLines(data.ingresses),   defaultOpen: false },
    { key: "netpolicies", label: "Network Policies",  icon: "🛡", color: "#a78bfa", count: countLines(data.netpolicies), defaultOpen: false },
    { key: "endpoints",   label: "Endpoints",         icon: "📍", color: "#64748b", count: countLines(data.endpoints),   defaultOpen: false },
  ].filter(s => data[s.key]), [data]);

  const preItems = useMemo(() => [
    { key: "ports",      label: "Listening Ports", icon: "🔌" },
    { key: "routes",     label: "Routes",          icon: "🗺" },
    { key: "interfaces", label: "Interfaces",      icon: "📡" },
    { key: "dns",        label: "DNS",             icon: "🔎" },
  ].filter(p => data[p.key]), [data]);

  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      {/* summary */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
        background: "#0b0d14", borderBottom: "1px solid #1e2235", flexShrink: 0, flexWrap: "wrap",
      }}>
        {sections.map(s => (
          <div key={s.key} style={{
            display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
            background: s.color + "15", border: `1px solid ${s.color}33`, borderRadius: 6,
          }}>
            <span style={{ fontSize: 11 }}>{s.icon}</span>
            <span style={{ fontSize: 12, color: s.color, fontWeight: 600 }}>{s.count}</span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>{s.label}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {sections.map(s => (
          <Card key={s.key} title={s.label} hint={`${s.count}`} defaultOpen={s.defaultOpen}>
            <div style={{ overflowX: "auto" }}><KubectlTable raw={data[s.key] ?? ""} colorFn={s.colorFn} emptyMessage={`No ${s.label.toLowerCase()}`} /></div>
          </Card>
        ))}
        {preItems.map(p => (
          <Card key={p.key} title={`${p.icon} ${p.label}`} defaultOpen={p.key === "ports"}>
            <Pre>{data[p.key]}</Pre>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Docker tabs ───────────────────────────────────────────────────────────────

export function DockerContainersTab({ data }: { data: Record<string, string> }) {
  const raw = data.output ?? "";
  const colorFn: ColorFn = (val, col) => {
    if (col.toUpperCase() === "STATUS") {
      if (/^Up/i.test(val))    return "#22c55e";
      if (/Exited/i.test(val)) return "#ef4444";
      if (/Paused/i.test(val)) return "#f59e0b";
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
        background: "#0b0d14", borderBottom: "1px solid #1e2235", flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{counts.total} Containers</span>
        <div style={{ width: 1, height: 20, background: "#2d3148" }} />
        {counts.up > 0 && <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e" }} />
          <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 600 }}>{counts.up}</span>
          <span style={{ fontSize: 11, color: "#64748b" }}>Running</span>
        </div>}
        {counts.exited > 0 && <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", animation: "pulse 2s ease-in-out infinite" }} />
          <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 600 }}>{counts.exited}</span>
          <span style={{ fontSize: 11, color: "#64748b" }}>Exited</span>
        </div>}
        {counts.paused > 0 && <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f59e0b" }} />
          <span style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>{counts.paused}</span>
          <span style={{ fontSize: 11, color: "#64748b" }}>Paused</span>
        </div>}
      </div>
      <KubectlTable raw={raw} colorFn={colorFn} emptyMessage="No containers running" />
    </div>
  );
}

export function DockerVolumesTab({ data }: { data: Record<string, string> }) {
  const raw = data.output ?? "";
  const count = useMemo(() => {
    if (!hasKubectlData(raw)) return 0;
    return raw.split("\n").slice(1).filter(l => l.trim()).length;
  }, [raw]);
  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
        background: "#0b0d14", borderBottom: "1px solid #1e2235", flexShrink: 0,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
          background: "#818cf815", border: "1px solid #818cf833", borderRadius: 6,
        }}>
          <span style={{ fontSize: 11 }}>💾</span>
          <span style={{ fontSize: 12, color: "#818cf8", fontWeight: 600 }}>{count}</span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>Volumes</span>
        </div>
      </div>
      <KubectlTable raw={raw} emptyMessage="No Docker volumes" />
    </div>
  );
}

export function DockerImagesTab({ data }: { data: Record<string, string> }) {
  const raw = data.output ?? "";
  const count = useMemo(() => {
    if (!hasKubectlData(raw)) return 0;
    return raw.split("\n").slice(1).filter(l => l.trim()).length;
  }, [raw]);
  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
        background: "#0b0d14", borderBottom: "1px solid #1e2235", flexShrink: 0,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
          background: "#06b6d415", border: "1px solid #06b6d433", borderRadius: 6,
        }}>
          <span style={{ fontSize: 11 }}>📦</span>
          <span style={{ fontSize: 12, color: "#06b6d4", fontWeight: 600 }}>{count}</span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>Images</span>
        </div>
      </div>
      <KubectlTable raw={raw} emptyMessage="No Docker images" />
    </div>
  );
}

export function DockerStatsTab({ data }: { data: Record<string, string> }) {
  const raw = data.output ?? "";
  const colorFn: ColorFn = (val, col) => {
    const upper = col.toUpperCase();
    if (upper === "CPU %" || upper === "MEM %") {
      const pct = parseFloat(val);
      if (pct > 80) return "#ef4444";
      if (pct > 50) return "#f59e0b";
      if (pct > 0)  return "#22c55e";
    }
    return null;
  };
  return (
    <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
        background: "#0b0d14", borderBottom: "1px solid #1e2235", flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>📊 Container Stats</span>
        <span style={{ fontSize: 11, color: "#475569" }}>CPU & memory usage (live snapshot)</span>
      </div>
      <KubectlTable raw={raw} colorFn={colorFn} emptyMessage="No container stats available" />
    </div>
  );
}
