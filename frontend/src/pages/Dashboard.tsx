import { useState, useEffect, useCallback, useMemo, useDeferredValue, type MouseEvent } from "react";
import type { Target } from "../types";
import { TABS_BY_TYPE }  from "../types";
import { api, readSSE }  from "../api/client";
import { useTargetChat } from "../hooks/useChat";
import { ChatPanel } from "../components/ChatPanel";
import { LogStream } from "../components/LogStream";
import { ResourceGraph } from "../components/ResourceGraph";
import { parseKubectl } from "../utils/parseKubectl";
import { BTN_TRANSITION, btnHoverStyle, btnActiveStyle, TAB_TRANSITION, tabHoverStyle, fadeInStyle } from "../utils/animations";
import {
  RingChart, PodSummaryBar, Card, NoTargetEmptyState,
  ContextualHint, Pre, LoadingSpinner, SkeletonLoader,
} from "./dashboard/primitives";

interface Props {
  target: Target | null;
}

export function Dashboard({ target }: Props) {
  const [activeTab, setActiveTab]   = useState<string | null>(null);
  const [tabData,   setTabData]     = useState<Record<string, string>>({});
  const [tabLoading, setTabLoading] = useState(false);

  const { messages, loading: chatLoading, send, clear } = useTargetChat(target?.id ?? null);
  const [logStream, setLogStream] = useState<{ pod: string; namespace: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reloadTab = useCallback(() => setReloadKey(k => k + 1), []);
  const [topoNamespace, setTopoNamespace] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // ── Namespace selector state (K8s targets only) ────────────────────────────
  const [nsFilter,    setNsFilter]    = useState("");       // "" = all namespaces
  const [namespaces,  setNamespaces]  = useState<string[]>([]);
  const [nsLoading,   setNsLoading]   = useState(false);

  const isK8s = target?.type === "kubernetes";

  // Fetch namespaces when target changes
  useEffect(() => {
    if (!target || !isK8s) { setNamespaces([]); return; }
    setNsLoading(true);
    api.namespaces(target.id)
      .then(ns => setNamespaces(ns))
      .catch(() => setNamespaces([]))
      .finally(() => setNsLoading(false));
  }, [target?.id, isK8s]);

  // Reset tab when target changes
  useEffect(() => {
    if (!target) { setActiveTab(null); return; }
    const tabs = TABS_BY_TYPE[target.type];
    setActiveTab(tabs[0].id);
    setLastRefreshed(null);
    setNsFilter("");
    clear();
  }, [target?.id, clear]);

  // Load tab data when tab changes (skip for chat/topology tabs)
  useEffect(() => {
    if (!target || !activeTab || activeTab === "__chat" || activeTab === "__topology") return;
    setTabLoading(true);
    setTabData({});
    const params: Record<string, string> = {};
    if (isK8s && nsFilter) params.ns = nsFilter;
    api.tab(target.id, activeTab, Object.keys(params).length ? params : undefined)
      .then(d => { setTabData(d); setLastRefreshed(new Date()); })
      .catch((e) => {
        console.error(`[Dashboard] tab "${activeTab}" load failed:`, e);
        const detail = (e as Error)?.message ? ` (${(e as Error).message})` : "";
        setTabData({ error: `Could not load ${activeTab} data${detail} — check kubectl access and cluster connectivity.` });
      })
      .finally(() => setTabLoading(false));
  }, [target?.id, activeTab, reloadKey, nsFilter, isK8s]);

  if (!target) {
    return <NoTargetEmptyState />;
  }

  const tabs = TABS_BY_TYPE[target.type];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Page header */}
      <div style={{
        padding: "12px 20px",
        borderBottom: "1px solid #1e2235",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexShrink: 0,
        background: "#0f1219",
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c8cf8" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        <span style={{ fontSize: 11, color: "#475569", fontWeight: 500 }}>Dashboard</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        <strong style={{ fontSize: 15 }}>{target.name}</strong>
        <span style={{ fontSize: 12, color: "#64748b", background: "#1a1d27", padding: "2px 8px", borderRadius: 4 }}>{target.type}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {/* Namespace selector for K8s targets */}
          {isK8s && activeTab !== "__chat" && activeTab !== "__topology" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
                <rect x="2" y="2" width="20" height="20" rx="4"/>
                <path d="M8 2v20"/><path d="M16 2v20"/>
              </svg>
              <select
                value={nsFilter}
                onChange={e => setNsFilter(e.target.value)}
                disabled={nsLoading}
                style={{
                  background: "#0d1117", border: "1px solid #2d3148", color: nsFilter ? "#818cf8" : "#94a3b8",
                  borderRadius: 5, padding: "4px 8px", fontSize: 11, cursor: "pointer",
                  minWidth: 140, fontWeight: nsFilter ? 600 : 400,
                }}
              >
                <option value="">All namespaces</option>
                {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
              </select>
            </div>
          )}
          {lastRefreshed && (
            <span style={{ fontSize: 11, color: "#475569" }}>
              Refreshed {Math.round((Date.now() - lastRefreshed.getTime()) / 60000) < 1
                ? "just now"
                : `${Math.round((Date.now() - lastRefreshed.getTime()) / 60000)}m ago`}
            </span>
          )}
          {!tabLoading && activeTab && activeTab !== "__chat" && activeTab !== "__topology" && (
            <button onClick={reloadTab} aria-label="Refresh tab data" title="Refresh"
            onMouseEnter={e => Object.assign(e.currentTarget.style, btnHoverStyle)}
            onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
            onMouseDown={e => Object.assign(e.currentTarget.style, btnActiveStyle)}
            onMouseUp={e => Object.assign(e.currentTarget.style, btnHoverStyle)}
            style={{
              background: "none", border: "1px solid #2d3148", borderRadius: 5,
              color: "#64748b", cursor: "pointer", display: "flex", alignItems: "center",
              gap: 5, padding: "4px 8px", fontSize: 11, transition: BTN_TRANSITION,
            }}>
              <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/>
              </svg>
              Refresh
            </button>
          )}
        </div>
      </div>

      <ContextualHint id="cmd-k">Press Cmd+K (or Ctrl+K) to search across all resources instantly.</ContextualHint>

      {/* Tab bar */}
      <div role="tablist" aria-label="Dashboard sections" style={{ display: "flex", background: "#0b0d14", borderBottom: "1px solid #1e2235", flexShrink: 0, padding: "0 12px", overflowX: "auto" }}>
        {tabs.map(t => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(t.id)}
              onMouseEnter={e => { if (!active) Object.assign(e.currentTarget.style, tabHoverStyle); }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.color = "#64748b"; e.currentTarget.style.background = "transparent"; } }}
              style={{
                padding: "10px 14px", fontSize: 12, border: "none", background: "transparent",
                color: active ? "#818cf8" : "#64748b",
                borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
                cursor: "pointer", whiteSpace: "nowrap", fontWeight: active ? 600 : 400,
                transition: TAB_TRANSITION,
              }}
            >
              {t.label}
            </button>
          );
        })}
        <button
          role="tab"
          aria-selected={activeTab === "__chat"}
          onClick={() => setActiveTab("__chat")}
          onMouseEnter={e => { if (activeTab !== "__chat") Object.assign(e.currentTarget.style, tabHoverStyle); }}
          onMouseLeave={e => { if (activeTab !== "__chat") { e.currentTarget.style.color = "#64748b"; e.currentTarget.style.background = "transparent"; } }}
          style={{
            padding: "10px 14px", fontSize: 12, border: "none", background: "transparent",
            color: activeTab === "__chat" ? "#818cf8" : "#64748b",
            borderBottom: activeTab === "__chat" ? "2px solid #6366f1" : "2px solid transparent",
            cursor: "pointer", whiteSpace: "nowrap",
            fontWeight: activeTab === "__chat" ? 600 : 400,
            display: "flex", alignItems: "center", gap: 5,
            transition: TAB_TRANSITION,
          }}
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          AI Chat
        </button>
        {(target.type === "kubernetes" || target.type === "ssh" || target.type === "local") && (
          <button
            role="tab"
            aria-selected={activeTab === "__topology"}
            onClick={() => setActiveTab("__topology")}
            onMouseEnter={e => { if (activeTab !== "__topology") Object.assign(e.currentTarget.style, tabHoverStyle); }}
            onMouseLeave={e => { if (activeTab !== "__topology") { e.currentTarget.style.color = "#64748b"; e.currentTarget.style.background = "transparent"; } }}
            style={{
              padding: "10px 14px", fontSize: 12, border: "none", background: "transparent",
              color: activeTab === "__topology" ? "#818cf8" : "#64748b",
              borderBottom: activeTab === "__topology" ? "2px solid #6366f1" : "2px solid transparent",
              cursor: "pointer", whiteSpace: "nowrap",
              fontWeight: activeTab === "__topology" ? 600 : 400,
              display: "flex", alignItems: "center", gap: 5,
              transition: TAB_TRANSITION,
            }}
          >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/>
              <line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/>
            </svg>
            Topology
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
          {activeTab === "__chat" ? (
            <div key="__chat" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", ...fadeInStyle }}>
              <ContextualHint id="chat-intro">Ask anything — "which pods are failing?", "show me memory usage", "why is nginx crashing?"</ContextualHint>
              <ChatPanel
                messages={messages}
                loading={chatLoading}
                onSend={send}
                placeholder={`Ask about ${target.name}…`}
              />
            </div>
          ) : activeTab === "__topology" ? (
            <div key="__topology" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", ...fadeInStyle }}>
              <div style={{ padding: "8px 16px", borderBottom: "1px solid #1e2235", display: "flex", alignItems: "center", gap: 8, background: "#0b0d14", flexShrink: 0 }}>
                <label style={{ fontSize: 11, color: "#64748b" }}>Namespace</label>
                <input
                  value={topoNamespace}
                  onChange={e => setTopoNamespace(e.target.value)}
                  placeholder="all namespaces"
                  style={{ background: "#161b27", border: "1px solid #2d3555", color: "#e2e8f0", borderRadius: 5, padding: "3px 8px", fontSize: 11, width: 180 }}
                />
              </div>
              <ContextualHint id="topology-click">Click any node to inspect its details, logs, and run an AI diagnosis.</ContextualHint>
              <ResourceGraph target={target} namespace={topoNamespace} />
            </div>
          ) : (
            <div key={activeTab} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", ...fadeInStyle }}>
            <TabContent
              tabId={activeTab}
              data={tabData}
              loading={tabLoading}
              target={target}
              onStreamLogs={(pod, namespace) => setLogStream({ pod, namespace })}
              onRetry={reloadTab}
            />
            </div>
          )}
        </div>

        {/* Log stream tray (P4) */}
        {logStream && target && (
          <LogStream
            target={target}
            pod={logStream.pod}
            namespace={logStream.namespace}
            onClose={() => setLogStream(null)}
          />
        )}
      </div>
    </div>
  );
}

// ── Tab content renderer ──────────────────────────────────────────────────────

interface TabContentProps {
  tabId:   string | null;
  data:    Record<string, string>;
  loading: boolean;
  target:  Target;
  onStreamLogs?: (pod: string, namespace: string) => void;
  onRetry?: () => void;
}

function TabContent({ tabId, data, loading, target, onStreamLogs, onRetry }: TabContentProps) {
  if (loading) return <SkeletonLoader />;
  if (!tabId)  return null;

  if (data.error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, ...fadeInStyle }}>
        <div style={{ background: "#2a0011", border: "1px solid #f43f5e", borderRadius: 8, padding: "14px 20px", fontSize: 13, color: "#fb7185", maxWidth: 480, textAlign: "center" }}>
          {data.error}
        </div>
        {onRetry && (
          <button onClick={onRetry}
          onMouseEnter={e => Object.assign(e.currentTarget.style, btnHoverStyle)}
          onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
          onMouseDown={e => Object.assign(e.currentTarget.style, btnActiveStyle)}
          onMouseUp={e => Object.assign(e.currentTarget.style, btnHoverStyle)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#1a1d27", border: "1px solid #2d3148",
            color: "#94a3b8", borderRadius: 6, padding: "6px 14px",
            fontSize: 12, cursor: "pointer", transition: BTN_TRANSITION,
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/>
            </svg>
            Retry
          </button>
        )}
      </div>
    );
  }

  const ttype = target.type;

  // Overview — rich metric cards for SSH/local
  if ((ttype === "ssh" || ttype === "local") && tabId === "overview") {
    return <OverviewTab data={data} />;
  }

  // Nodes — cluster-scoped, separate parser
  if (ttype === "kubernetes" && tabId === "nodes") {
    return <NodeTable raw={data.output ?? ""} target={target} />;
  }

  // Pods — clickable table
  if (tabId === "pods") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <ContextualHint id="pods-diagnose">Unhealthy pods show a ✦ Diagnose button — click it for an instant AI diagnosis without opening chat.</ContextualHint>
        <PodTable raw={data.pods ?? data.output ?? ""} target={target} onStreamLogs={onStreamLogs} />
      </div>
    );
  }

  // Logs — colorized
  if (tabId === "logs") {
    return <LogsTab raw={data.logs ?? ""} target={target} />;
  }

  // Kubernetes rich tabs
  if (tabId === "events")      return <EventsTab      data={data} />;
  if (tabId === "services")    return <ServicesTab    data={data} />;
  if (tabId === "workloads")   return <WorkloadsTab   data={data} />;
  if (tabId === "k8s_storage") return <K8sStorageTab  data={data} />;
  if (tabId === "ingress")     return <IngressTab     data={data} />;
  if (tabId === "network")     return <NetworkTab     data={data} />;

  // Docker rich tabs
  if (tabId === "containers")  return <DockerContainersTab data={data} />;
  if (tabId === "volumes")     return <DockerVolumesTab data={data} />;
  if (tabId === "images")      return <DockerImagesTab data={data} />;
  if (tabId === "stats")       return <DockerStatsTab data={data} />;

  // Generic — card-per-key
  return <GenericTab data={data} />;
}

// ── Overview metric cards ─────────────────────────────────────────────────────

function OverviewTab({ data }: { data: Record<string, string> }) {
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

// ── Node table — hoisted constants ────────────────────────────────────────────

const nodeStatusColor = (s: string) => s === "Ready" ? "#22c55e" : "#ef4444";

function NodeTable({ raw, target }: { raw: string; target: Target }) {
  const [resource, setResource] = useState<{ kind: string; name: string; ns: string; data: Record<string, string> } | null>(null);
  const [loading, setLoading]   = useState(false);

  const allLines = useMemo(() => raw.trim().split("\n"), [raw]);

  const openNode = useCallback(async (name: string) => {
    setLoading(true);
    try {
      const d = await api.resource(target.id, "node", name, "");
      setResource({ kind: "node", name, ns: "", data: d });
    } finally {
      setLoading(false);
    }
  }, [target.id]);

  if (!raw || raw.includes("ERROR") || raw.includes("not found")) {
    return <div style={{ padding: 20, color: "#64748b", fontSize: 13 }}>kubectl not available or no nodes found.</div>;
  }
  if (allLines.length < 2) return <Pre>{raw}</Pre>;

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#0d1117", position: "sticky", top: 0 }}>
            {["Name", "Status", "Roles", "Age", "Version", "Internal IP"].map(h => (
              <th key={h} style={{ padding: "7px 12px", textAlign: "left", fontSize: 11, color: "#64748b", textTransform: "uppercase", borderBottom: "1px solid #2d3148" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allLines.slice(1).map((line, i) => {
            const c = line.trim().split(/\s+/);
            if (c.length < 4) return null;
            const [name, status, roles, age, version, internalIp] = c;
            const sc = nodeStatusColor(status);
            return (
              <tr key={i} onClick={() => openNode(name)}
                tabIndex={0}
                role="button"
                aria-label={`View node ${name}`}
                onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openNode(name); } }}
                style={{ cursor: "pointer", transition: "background .1s" }}
                onMouseEnter={(ev: MouseEvent<HTMLTableRowElement>) => (ev.currentTarget.style.background = "#1a1d27")}
                onMouseLeave={(ev: MouseEvent<HTMLTableRowElement>) => (ev.currentTarget.style.background = "transparent")}
              >
                <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 500 }}>{name}</td>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{ background: sc + "22", color: sc, border: `1px solid ${sc}44`, borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 600 }}>{status}</span>
                </td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: "#94a3b8" }}>{roles}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: "#64748b" }}>{age}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: "#64748b" }}>{version ?? "—"}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: "#64748b" }}>{internalIp ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {(resource || loading) && (
        <ResourceModal resource={resource} loading={loading} targetId={target.id} onClose={() => setResource(null)} />
      )}
    </div>
  );
}

// ── Pod table — module-level constants (hoisted to avoid recreation per render)

const POD_BAD_STATUSES = new Set(["CrashLoopBackOff", "Error", "OOMKilled", "ImagePullBackOff", "ErrImagePull", "CreateContainerError"]);

const podStatusColor = (s: string) =>
  s === "Running" ? "#22c55e" : s.includes("Error") || s.includes("Crash") || s === "OOMKilled" ? "#ef4444" : "#f59e0b";

// ── Pod table ─────────────────────────────────────────────────────────────────

function PodTable({ raw, target, onStreamLogs }: { raw: string; target: Target; onStreamLogs?: (pod: string, ns: string) => void }) {
  const [resource,     setResource]     = useState<{ kind: string; name: string; ns: string; data: Record<string, string> } | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [nsFilter,     setNsFilter]     = useState("");
  const [search,       setSearch]       = useState("");
  const [aiBadges,     setAiBadges]     = useState<Record<string, string>>({});
  const [badgeLoading, setBadgeLoading] = useState<Record<string, boolean>>({});

  // Defer search filter so typing stays responsive with 200+ rows
  const deferredSearch = useDeferredValue(search);

  const allLines = useMemo(() => raw.trim().split("\n"), [raw]);

  const namespaces = useMemo(() =>
    [...new Set(allLines.slice(1).map(l => l.trim().split(/\s+/)[0]).filter(Boolean))],
    [allLines]
  );

  const lines = useMemo(() =>
    allLines.slice(1).filter(line => {
      const c = line.trim().split(/\s+/);
      if (nsFilter && c[0] !== nsFilter) return false;
      if (deferredSearch && !line.toLowerCase().includes(deferredSearch.toLowerCase())) return false;
      return true;
    }),
    [allLines, nsFilter, deferredSearch]
  );

  const openResource = useCallback(async (kind: string, name: string, ns: string) => {
    setLoading(true);
    try {
      const d = await api.resource(target.id, kind, name, ns);
      setResource({ kind, name, ns, data: d });
    } finally {
      setLoading(false);
    }
  }, [target.id]);

  const fetchAIBadge = useCallback(async (name: string, ns: string, status: string) => {
    const key = `${ns}/${name}`;
    setBadgeLoading(prev => ({ ...prev, [key]: true }));
    try {
      const res = await api.analyzeStream(`Quick 1-sentence diagnosis for pod "${name}" in namespace "${ns}" with status "${status}". Be concise.`);
      let text = "";
      for await (const evt of readSSE(res)) {
        if (typeof evt.t === "string") text += evt.t;
      }
      setAiBadges(prev => ({ ...prev, [key]: text.slice(0, 120) }));
    } catch {
      setAiBadges(prev => ({ ...prev, [key]: "AI unavailable" }));
    } finally {
      setBadgeLoading(prev => ({ ...prev, [key]: false }));
    }
  }, []);

  if (!raw || raw.includes("ERROR") || raw.includes("not found")) {
    return <div style={{ padding: 20, color: "#64748b", fontSize: 13 }}>kubectl not available or no pods found.</div>;
  }
  if (allLines.length < 2) return <Pre>{raw}</Pre>;

  // Skill #6: count pods by status for summary bar
  const podCounts = useMemo(() => {
    const counts = { running: 0, pending: 0, bad: 0, total: 0 };
    allLines.slice(1).forEach(line => {
      const c = line.trim().split(/\s+/);
      if (c.length < 4) return;
      const status = c[3];
      counts.total++;
      if (status === "Running")                      counts.running++;
      else if (status === "Pending")                 counts.pending++;
      else if (POD_BAD_STATUSES.has(status))         counts.bad++;
    });
    return counts;
  }, [allLines]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Skill #6: Pod status summary bar */}
      {podCounts.total > 0 && <PodSummaryBar counts={podCounts} />}
      {/* filter bar */}
      <div style={{ padding: "8px 16px", background: "#0d1017", display: "flex", gap: 8, flexShrink: 0 }}>
        <select
          value={nsFilter}
          onChange={e => setNsFilter(e.target.value)}
          style={{ background: "#0f1117", border: "1px solid #2d3148", color: "#e2e8f0", borderRadius: 6, padding: "5px 10px", fontSize: 12 }}
        >
          <option value="">All namespaces</option>
          {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
        </select>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search pods…"
          style={{ background: "#0f1117", border: "1px solid #2d3148", color: "#e2e8f0", borderRadius: 6, padding: "5px 10px", fontSize: 12, flex: 1 }}
        />
        <span style={{ fontSize: 11, color: "#475569", alignSelf: "center" }}>
          {lines.length} pod{lines.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* table */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#0d1117", position: "sticky", top: 0 }}>
              {["Namespace","Name","Ready","Status","Restarts","Age","",""].map(h => (
                <th key={h} style={{ padding: "7px 12px", textAlign: "left", fontSize: 11, color: "#64748b", textTransform: "uppercase", borderBottom: "1px solid #2d3148" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const c = line.trim().split(/\s+/);
              if (c.length < 5) return null;
              const [ns, name, ready, status] = c;
              const restarts = c[4] ?? "0";
              const sc = podStatusColor(status);
              const isBad = POD_BAD_STATUSES.has(status);
              const badgeKey = `${ns}/${name}`;
              return (
                <tr key={i} onClick={() => openResource("pod", name, ns)}
                  tabIndex={0}
                  role="button"
                  aria-label={`View pod ${name} in ${ns}`}
                  onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openResource("pod", name, ns); } }}
                  style={{ cursor: "pointer", transition: "background .1s" }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = "#1a1d27")}
                  onMouseLeave={ev => (ev.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "8px 12px", fontSize: 12, color: "#64748b" }}>{ns}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>
                    {name}
                    {/* P3: Inline AI badge for unhealthy pods */}
                    {isBad && !aiBadges[badgeKey] && !badgeLoading[badgeKey] && (
                      <button
                        onClick={e => { e.stopPropagation(); fetchAIBadge(name, ns, status); }}
                        aria-label={`Diagnose pod ${name}`}
                        title="Get AI diagnosis for this pod"
                        style={{
                          marginLeft: 6, background: "#818cf822", border: "1px solid #818cf844",
                          color: "#818cf8", borderRadius: 4, padding: "2px 7px",
                          fontSize: 11, fontWeight: 600, cursor: "pointer", verticalAlign: "middle",
                        }}
                      >
                        ✦ Diagnose
                      </button>
                    )}
                    {badgeLoading[badgeKey] && (
                      <span style={{ marginLeft: 6, fontSize: 9, color: "#818cf8" }}>analyzing…</span>
                    )}
                    {aiBadges[badgeKey] && (
                      <div style={{
                        marginTop: 3, fontSize: 10, color: "#a5b4fc", lineHeight: 1.4,
                        background: "#1e2240", border: "1px solid #6366f133",
                        borderRadius: 4, padding: "3px 7px", maxWidth: 400,
                      }}>
                        ✦ {aiBadges[badgeKey]}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 12, color: "#64748b" }}>{ready}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ background: sc + "22", color: sc, border: `1px solid ${sc}44`, borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 600 }}>
                      {status}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 12, color: +restarts > 5 ? "#f59e0b" : +restarts > 0 ? "#94a3b8" : "#64748b" }}>
                    {restarts}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 12, color: "#64748b" }}>{c[c.length - 1]}</td>
                  <td style={{ padding: "8px 12px" }}>
                    {onStreamLogs && (
                      <button
                        onClick={e => { e.stopPropagation(); onStreamLogs(name, ns); }}
                        aria-label={`Stream live logs for pod ${name}`}
                        title="Stream live logs"
                        style={{
                          background: "#06b6d422", border: "1px solid #06b6d444",
                          color: "#06b6d4", borderRadius: 4, padding: "2px 7px",
                          fontSize: 10, fontWeight: 600, cursor: "pointer",
                        }}
                      >
                        ▶ Logs
                      </button>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#334155", textAlign: "right" }}>›</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* resource detail modal */}
      {(resource || loading) && (
        <ResourceModal
          resource={resource}
          loading={loading}
          targetId={target.id}
          onClose={() => setResource(null)}
        />
      )}
    </div>
  );
}

// ── Resource detail modal ─────────────────────────────────────────────────────

function ResourceModal({ resource, loading, targetId: _targetId, onClose }: {
  resource: { kind: string; name: string; ns: string; data: Record<string, string> } | null;
  loading:  boolean;
  targetId: string;
  onClose:  () => void;
}) {
  const [tab, setTab] = useState<"describe" | "logs" | "previous" | "ai">("describe");
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const runAI = useCallback(async () => {
    if (!resource) return;
    setAiLoading(true);
    setAiText("");
    const prompt = `Analyze this Kubernetes ${resource.kind} "${resource.name}"${resource.ns ? " in namespace " + resource.ns : ""}.\n\nDescribe:\n${(resource.data.describe ?? "").slice(0, 3000)}\n\n${resource.data.logs ? "Recent logs:\n" + resource.data.logs.slice(-1000) : ""}`;
    try {
      const res = await api.analyzeStream(prompt);
      for await (const evt of readSSE(res)) {
        if (typeof evt.t === "string") setAiText(prev => prev + evt.t);
      }
    } finally {
      setAiLoading(false);
    }
  }, [resource]);

  useEffect(() => { if (tab === "ai" && resource && !aiText && !aiLoading) runAI(); }, [tab, resource, aiText, aiLoading, runAI]);

  // Escape key closes modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const hasPrevLogs = resource?.data.previous && !resource.data.previous.includes("[no previous");
  const modalTabs = ["describe", "logs", ...(hasPrevLogs ? ["previous"] : []), "ai"] as const;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000099", backdropFilter: "blur(2px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="modal-title"
           style={{ background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 12, width: 740, maxHeight: "82vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,.6), 0 4px 16px rgba(0,0,0,.4)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #2d3148", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ background: "#4f46e533", color: "#7c8cf8", border: "1px solid #4f46e5", borderRadius: 4, padding: "2px 7px", fontSize: 11 }}>
            {loading ? "…" : resource?.kind}
          </span>
          <strong id="modal-title" style={{ fontSize: 14 }}>{resource?.name}</strong>
          {resource?.ns && <span style={{ fontSize: 12, color: "#64748b" }}>· {resource.ns}</span>}
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#475569" }}>Esc to close</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", display: "flex", alignItems: "center", padding: 4 }}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        {!loading && resource && (
          <>
            <div style={{ display: "flex", borderBottom: "1px solid #2d3148", padding: "0 16px" }}>
              {modalTabs.map(t => (
                <button key={t} onClick={() => setTab(t as typeof tab)} style={{
                  padding: "8px 14px", fontSize: 12, background: "none", border: "none",
                  color: tab === t ? "#7c8cf8" : "#64748b", borderBottom: tab === t ? "2px solid #7c8cf8" : "2px solid transparent",
                  cursor: "pointer", textTransform: "capitalize",
                }}>{t === "previous" ? "Prev Logs" : t === "ai" ? "AI Analysis" : t === "describe" ? "Details" : t}</button>
              ))}
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
              {tab === "ai"
                ? (aiLoading ? <LoadingSpinner /> : <div style={{ fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{aiText}</div>)
                : <Pre>{resource.data[tab === "previous" ? "previous" : tab] ?? "—"}</Pre>
              }
            </div>
          </>
        )}
        {loading && <LoadingSpinner />}
      </div>
    </div>
  );
}

// ── Logs tab ──────────────────────────────────────────────────────────────────

function LogsTab({ raw, target }: { raw: string; target: Target }) {
  const [content,  setContent]  = useState(raw);
  const [selected, setSelected] = useState("");

  const load = (unit: string) => {
    setSelected(unit);
    api.tab(target.id, "logs", unit ? { unit } : {}).then(d => setContent(d.logs ?? ""));
  };

  const filters = [
    { key: "",           label: "All" },
    { key: "kubelet",    label: "kubelet" },
    { key: "containerd", label: "containerd" },
    { key: "ssh",        label: "sshd" },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #1e2235", display: "flex", gap: 6, background: "#0b0d14" }}>
        {filters.map(f => {
          const active = selected === f.key;
          return (
            <button
              key={f.key}
              onClick={() => load(f.key)}
              style={{
                background: active ? "#1e2340" : "transparent",
                border: `1px solid ${active ? "#6366f1" : "#1e2235"}`,
                color: active ? "#818cf8" : "#64748b",
                borderRadius: 5, padding: "4px 10px", fontSize: 11,
                cursor: "pointer", fontWeight: active ? 600 : 400,
                transition: "all .15s",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {content ? <Pre>{content}</Pre> : (
          <div style={{ color: "#475569", fontSize: 13, textAlign: "center", paddingTop: 40 }}>No logs found</div>
        )}
      </div>
    </div>
  );
}

// ── Generic ───────────────────────────────────────────────────────────────────

function GenericTab({ data }: { data: Record<string, string> }) {
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

// ── Generic kubectl table renderer ───────────────────────────────────────────


type ColorFn = (val: string, col: string) => string | null;

function KubectlTable({ raw, colorFn, onRowClick }: {
  raw:        string;
  colorFn?:   ColorFn;
  onRowClick?: (cols: string[], headers: string[]) => void;
}) {
  const noData = !raw || /^\[?(TIMEOUT|ERROR|No resources|not found)/i.test(raw.trim());
  if (noData) return <div style={{ padding: "20px 16px", color: "#475569", fontSize: 13 }}>{raw?.trim() || "No data"}</div>;

  const { headers, rows } = parseKubectl(raw);
  if (!headers.length) return <div style={{ padding: "20px 16px", color: "#475569", fontSize: 13 }}>No data</div>;

  return (
    <table role="grid" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: "#0d1117" }}>
          {headers.map(h => (
            <th key={h} scope="col" style={{ padding: "7px 12px", textAlign: "left", fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".4px", borderBottom: "1px solid #2d3148", whiteSpace: "nowrap" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cols, i) => (
          <tr key={i}
            tabIndex={onRowClick ? 0 : undefined}
            onClick={() => onRowClick?.(cols, headers)}
            onKeyDown={e => { if (onRowClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRowClick(cols, headers); } }}
            style={{ cursor: onRowClick ? "pointer" : "default", background: i % 2 === 1 ? "#0c0e16" : "transparent", transition: "background .1s" }}
            onMouseEnter={ev => { if (onRowClick) ev.currentTarget.style.background = "#1a1d27"; }}
            onMouseLeave={ev => { ev.currentTarget.style.background = i % 2 === 1 ? "#0c0e16" : "transparent"; }}
          >
            {headers.map((h, j) => {
              const val = cols[j] ?? "—";
              const color = colorFn?.(val, h);
              return (
                <td key={j} style={{ padding: "7px 12px", color: j === 0 ? "#e2e8f0" : "#94a3b8", verticalAlign: "top" }}>
                  {color
                    ? <span style={{ background: color + "22", color, border: `1px solid ${color}44`, borderRadius: 4, padding: "2px 6px", fontSize: 11, fontWeight: 600 }}>{val}</span>
                    : val}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Events tab ────────────────────────────────────────────────────────────────

function EventsTab({ data }: { data: Record<string, string> }) {
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
    if (raw && !raw.includes("No resources") && !raw.includes("[TIMEOUT")) {
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
      <KubectlTable raw={raw} colorFn={colorFn} />
    </div>
  );
}

// ── Services tab ──────────────────────────────────────────────────────────────

function ServicesTab({ data }: { data: Record<string, string> }) {
  const raw = data.services ?? "";
  const colorFn: ColorFn = (val, col) => {
    if (col.toUpperCase() === "TYPE") {
      if (val === "LoadBalancer") return "#818cf8";
      if (val === "NodePort")     return "#06b6d4";
      if (val === "ClusterIP")    return "#64748b";
      if (val === "ExternalName") return "#f59e0b";
    }
    return null;
  };

  const counts = useMemo(() => {
    const c = { lb: 0, np: 0, cip: 0, ext: 0, total: 0 };
    if (raw && !raw.includes("No resources") && !raw.includes("[TIMEOUT")) {
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
      <KubectlTable raw={raw} colorFn={colorFn} />
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

function parseWorkloadCounts(raw: string, label: string): { total: number; ready: number; notReady: number } {
  if (!raw || raw.includes("No resources") || raw.includes("[TIMEOUT") || raw.includes("error"))
    return { total: 0, ready: 0, notReady: 0 };
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

function WorkloadsTab({ data }: { data: Record<string, string> }) {
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
              <div style={{ width: `${failedAll / totalAll * 100}%`, background: "#ef4444", transition: "width .5s" }} />
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
        const hasData = raw && !raw.includes("No resources") && !raw.includes("[TIMEOUT");
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

function K8sStorageTab({ data }: { data: Record<string, string> }) {
  const pvcColor: ColorFn = (val, col) => {
    if (col.toUpperCase() === "STATUS") {
      if (val === "Bound")   return "#22c55e";
      if (val === "Pending") return "#f59e0b";
      if (val === "Lost")    return "#ef4444";
    }
    return null;
  };

  const counts = useMemo(() => {
    const c = { bound: 0, pending: 0, lost: 0, pvcs: 0, pvs: 0, sc: 0 };
    const pvcRaw = data.pvcs ?? "";
    if (pvcRaw && !pvcRaw.includes("No resources")) {
      for (const line of pvcRaw.split("\n").slice(1)) {
        if (!line.trim()) continue;
        c.pvcs++;
        if (/\bBound\b/.test(line)) c.bound++;
        else if (/\bPending\b/.test(line)) c.pending++;
        else if (/\bLost\b/.test(line)) c.lost++;
      }
    }
    const pvRaw = data.pvs ?? "";
    if (pvRaw && !pvRaw.includes("No resources"))
      c.pvs = pvRaw.split("\n").slice(1).filter(l => l.trim()).length;
    const scRaw = data.storageclasses ?? "";
    if (scRaw && !scRaw.includes("No resources"))
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
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.pvcs ?? ""} colorFn={pvcColor} /></div>
        </Card>
        <Card title="Persistent Volumes" hint={`${counts.pvs}`} defaultOpen={false}>
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.pvs ?? ""} colorFn={pvcColor} /></div>
        </Card>
        <Card title="Storage Classes" hint={`${counts.sc}`} defaultOpen={false}>
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.storageclasses ?? ""} /></div>
        </Card>
      </div>
    </div>
  );
}

// ── Ingress tab ───────────────────────────────────────────────────────────────

function IngressTab({ data }: { data: Record<string, string> }) {
  const counts = useMemo(() => {
    let ingresses = 0, classes = 0;
    const ingRaw = data.ingresses ?? "";
    if (ingRaw && !ingRaw.includes("No resources"))
      ingresses = ingRaw.split("\n").slice(1).filter(l => l.trim()).length;
    const clsRaw = data.ingressclasses ?? "";
    if (clsRaw && !clsRaw.includes("No resources"))
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
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.ingresses ?? ""} /></div>
        </Card>
        <Card title="Ingress Classes" hint={`${counts.classes}`} defaultOpen={false}>
          <div style={{ overflowX: "auto" }}><KubectlTable raw={data.ingressclasses ?? ""} /></div>
        </Card>
      </div>
    </div>
  );
}

// ── Network tab ───────────────────────────────────────────────────────────────

function NetworkTab({ data }: { data: Record<string, string> }) {
  const svcColor: ColorFn = (val, col) => {
    if (col.toUpperCase() === "TYPE") {
      if (val === "LoadBalancer") return "#818cf8";
      if (val === "NodePort")     return "#06b6d4";
    }
    return null;
  };

  const countLines = (raw?: string) => {
    if (!raw || raw.includes("No resources") || raw.includes("[TIMEOUT")) return 0;
    return raw.split("\n").slice(1).filter(l => l.trim()).length;
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
            <div style={{ overflowX: "auto" }}><KubectlTable raw={data[s.key] ?? ""} colorFn={s.colorFn} /></div>
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

function DockerContainersTab({ data }: { data: Record<string, string> }) {
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
    if (raw && !raw.includes("No resources") && !raw.includes("[TIMEOUT")) {
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
      <KubectlTable raw={raw} colorFn={colorFn} />
    </div>
  );
}

function DockerVolumesTab({ data }: { data: Record<string, string> }) {
  const raw = data.output ?? "";
  const count = useMemo(() => {
    if (!raw || raw.includes("[TIMEOUT")) return 0;
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
      <KubectlTable raw={raw} />
    </div>
  );
}

function DockerImagesTab({ data }: { data: Record<string, string> }) {
  const raw = data.output ?? "";
  const count = useMemo(() => {
    if (!raw || raw.includes("[TIMEOUT")) return 0;
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
      <KubectlTable raw={raw} />
    </div>
  );
}

function DockerStatsTab({ data }: { data: Record<string, string> }) {
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
      <KubectlTable raw={raw} colorFn={colorFn} />
    </div>
  );
}
