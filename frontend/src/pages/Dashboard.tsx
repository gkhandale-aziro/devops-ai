import { useState, useEffect, useCallback, type ReactNode, type MouseEvent } from "react";
import type { Target } from "../types";
import { TABS_BY_TYPE }  from "../types";
import { api, readSSE }  from "../api/client";
import { useTargetChat } from "../hooks/useChat";
import { ChatPanel } from "../components/ChatPanel";
import { LogStream } from "../components/LogStream";
import { ResourceGraph } from "../components/ResourceGraph";

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

  // Reset tab when target changes
  useEffect(() => {
    if (!target) { setActiveTab(null); return; }
    const tabs = TABS_BY_TYPE[target.type];
    setActiveTab(tabs[0].id);
    setLastRefreshed(null);
    clear();
  }, [target?.id]);

  // Load tab data when tab changes (skip for chat/topology tabs)
  useEffect(() => {
    if (!target || !activeTab || activeTab === "__chat" || activeTab === "__topology") return;
    setTabLoading(true);
    setTabData({});
    api.tab(target.id, activeTab)
      .then(d => { setTabData(d); setLastRefreshed(new Date()); })
      .catch(() => setTabData({ error: `Could not load ${activeTab} data — check kubectl access and cluster connectivity.` }))
      .finally(() => setTabLoading(false));
  }, [target?.id, activeTab, reloadKey]);

  if (!target) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, color: "#64748b" }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2d3148" strokeWidth="1.2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
        <div style={{ fontSize: 18, color: "#94a3b8", fontWeight: 600 }}>Aziro Ops</div>
        <div style={{ fontSize: 13 }}>Select a connection from the sidebar to get started.</div>
      </div>
    );
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
          {lastRefreshed && (
            <span style={{ fontSize: 11, color: "#475569" }}>
              Refreshed {Math.round((Date.now() - lastRefreshed.getTime()) / 60000) < 1
                ? "just now"
                : `${Math.round((Date.now() - lastRefreshed.getTime()) / 60000)}m ago`}
            </span>
          )}
          {!tabLoading && activeTab && activeTab !== "__chat" && activeTab !== "__topology" && (
            <button onClick={reloadTab} title="Refresh" style={{
              background: "none", border: "1px solid #2d3148", borderRadius: 5,
              color: "#64748b", cursor: "pointer", display: "flex", alignItems: "center",
              gap: 5, padding: "4px 8px", fontSize: 11,
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/>
              </svg>
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", background: "#0b0d14", borderBottom: "1px solid #1e2235", flexShrink: 0, padding: "0 12px", overflowX: "auto" }}>
        {tabs.map(t => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: "10px 14px", fontSize: 12, border: "none", background: "transparent",
                color: active ? "#818cf8" : "#64748b",
                borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
                cursor: "pointer", whiteSpace: "nowrap", fontWeight: active ? 600 : 400,
                transition: "color .15s",
              }}
            >
              {t.label}
            </button>
          );
        })}
        <button
          onClick={() => setActiveTab("__chat")}
          style={{
            padding: "10px 14px", fontSize: 12, border: "none", background: "transparent",
            color: activeTab === "__chat" ? "#818cf8" : "#64748b",
            borderBottom: activeTab === "__chat" ? "2px solid #6366f1" : "2px solid transparent",
            cursor: "pointer", whiteSpace: "nowrap",
            fontWeight: activeTab === "__chat" ? 600 : 400,
            display: "flex", alignItems: "center", gap: 5,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          AI Chat
        </button>
        {(target.type === "kubernetes" || target.type === "ssh" || target.type === "local") && (
          <button
            onClick={() => setActiveTab("__topology")}
            style={{
              padding: "10px 14px", fontSize: 12, border: "none", background: "transparent",
              color: activeTab === "__topology" ? "#818cf8" : "#64748b",
              borderBottom: activeTab === "__topology" ? "2px solid #6366f1" : "2px solid transparent",
              cursor: "pointer", whiteSpace: "nowrap",
              fontWeight: activeTab === "__topology" ? 600 : 400,
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
            <ChatPanel
              messages={messages}
              loading={chatLoading}
              onSend={send}
              placeholder={`Ask about ${target.name}…`}
            />
          ) : activeTab === "__topology" ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "8px 16px", borderBottom: "1px solid #1e2235", display: "flex", alignItems: "center", gap: 8, background: "#0b0d14", flexShrink: 0 }}>
                <label style={{ fontSize: 11, color: "#64748b" }}>Namespace</label>
                <input
                  value={topoNamespace}
                  onChange={e => setTopoNamespace(e.target.value)}
                  placeholder="all namespaces"
                  style={{ background: "#161b27", border: "1px solid #2d3555", color: "#e2e8f0", borderRadius: 5, padding: "3px 8px", fontSize: 11, width: 180 }}
                />
              </div>
              <ResourceGraph target={target} namespace={topoNamespace} />
            </div>
          ) : (
            <TabContent
              tabId={activeTab}
              data={tabData}
              loading={tabLoading}
              target={target}
              onStreamLogs={(pod, namespace) => setLogStream({ pod, namespace })}
              onRetry={reloadTab}
            />
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
  if (loading) return <LoadingSpinner />;
  if (!tabId)  return null;

  if (data.error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
        <div style={{ background: "#2a0011", border: "1px solid #f43f5e", borderRadius: 8, padding: "14px 20px", fontSize: 13, color: "#fb7185", maxWidth: 480, textAlign: "center" }}>
          {data.error}
        </div>
        {onRetry && (
          <button onClick={onRetry} style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#1a1d27", border: "1px solid #2d3148",
            color: "#94a3b8", borderRadius: 6, padding: "6px 14px",
            fontSize: 12, cursor: "pointer",
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
    return <PodTable raw={data.pods ?? data.output ?? ""} target={target} onStreamLogs={onStreamLogs} />;
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
      {/* metric cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
        {[
          { label: "CPU Usage",  val: `${cpuPct}%`,     sub: `Load avg: ${load}`,       pct: cpuPct },
          { label: "Memory",     val: `${memUsed}G`,    sub: `of ${memTotal}G (${memPct}%)`, pct: memPct },
          { label: "Disk",       val: diskUsed,          sub: `of ${diskTotal} (${diskPct}%)`, pct: diskPct },
          { label: "Uptime",     val: uptimeStr,         sub: os, pct: -1 },
        ].map(card => (
          <div key={card.label} style={{ background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>{card.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: card.pct >= 0 ? pctColor(card.pct) : "#7c8cf8" }}>{card.val}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{card.sub}</div>
            {card.pct >= 0 && (
              <div style={{ height: 4, background: "#2d3148", borderRadius: 2, marginTop: 10 }}>
                <div style={{ height: "100%", width: `${card.pct}%`, background: fillColor(card.pct), borderRadius: 2, transition: "width .5s" }} />
              </div>
            )}
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

// ── Node table ────────────────────────────────────────────────────────────────
// kubectl get nodes -o wide → NAME STATUS ROLES AGE VERSION INTERNAL-IP ...
// Nodes are cluster-scoped (no namespace), so openResource("node", name, "")

function NodeTable({ raw, target }: { raw: string; target: Target }) {
  const [resource, setResource] = useState<{ kind: string; name: string; ns: string; data: Record<string, string> } | null>(null);
  const [loading, setLoading]   = useState(false);

  if (!raw || raw.includes("ERROR") || raw.includes("not found")) {
    return <div style={{ padding: 20, color: "#64748b", fontSize: 13 }}>kubectl not available or no nodes found.</div>;
  }

  const allLines = raw.trim().split("\n");
  if (allLines.length < 2) return <Pre>{raw}</Pre>;

  const openNode = async (name: string) => {
    setLoading(true);
    try {
      const d = await api.resource(target.id, "node", name, "");
      setResource({ kind: "node", name, ns: "", data: d });
    } finally {
      setLoading(false);
    }
  };

  const statusColor = (s: string) => s === "Ready" ? "#22c55e" : "#ef4444";

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
            const sc = statusColor(status);
            return (
              <tr key={i} onClick={() => openNode(name)}
                style={{ borderBottom: "1px solid #1e2130", cursor: "pointer", transition: "background .1s" }}
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

// ── Pod table ─────────────────────────────────────────────────────────────────

function PodTable({ raw, target, onStreamLogs }: { raw: string; target: Target; onStreamLogs?: (pod: string, ns: string) => void }) {
  const [resource,  setResource]  = useState<{ kind: string; name: string; ns: string; data: Record<string, string> } | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [nsFilter,  setNsFilter]  = useState("");
  const [search,    setSearch]    = useState("");
  const [aiBadges,  setAiBadges]  = useState<Record<string, string>>({});
  const [badgeLoading, setBadgeLoading] = useState<Record<string, boolean>>({});

  if (!raw || raw.includes("ERROR") || raw.includes("not found")) {
    return <div style={{ padding: 20, color: "#64748b", fontSize: 13 }}>kubectl not available or no pods found.</div>;
  }

  const allLines = raw.trim().split("\n");
  if (allLines.length < 2) return <Pre>{raw}</Pre>;

  // collect unique namespaces from output
  const namespaces = [...new Set(
    allLines.slice(1).map(l => l.trim().split(/\s+/)[0]).filter(Boolean)
  )];

  // filter rows
  const lines = allLines.slice(1).filter(line => {
    const c = line.trim().split(/\s+/);
    if (nsFilter && c[0] !== nsFilter) return false;
    if (search && !line.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const openResource = async (kind: string, name: string, ns: string) => {
    setLoading(true);
    try {
      const d = await api.resource(target.id, kind, name, ns);
      setResource({ kind, name, ns, data: d });
    } finally {
      setLoading(false);
    }
  };

  const statusColor = (s: string) =>
    s === "Running" ? "#22c55e" : s.includes("Error") || s.includes("Crash") || s === "OOMKilled" ? "#ef4444" : "#f59e0b";

  const BAD_STATUSES = new Set(["CrashLoopBackOff", "Error", "OOMKilled", "ImagePullBackOff", "ErrImagePull", "CreateContainerError"]);

  const fetchAIBadge = async (name: string, ns: string, status: string) => {
    const key = `${ns}/${name}`;
    if (aiBadges[key] || badgeLoading[key]) return;
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
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* filter bar */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #2d3148", display: "flex", gap: 8, flexShrink: 0 }}>
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
              const sc = statusColor(status);
              const isBad = BAD_STATUSES.has(status);
              const badgeKey = `${ns}/${name}`;
              return (
                <tr key={i} onClick={() => openResource("pod", name, ns)}
                  style={{ borderBottom: "1px solid #1e2130", cursor: "pointer", transition: "background .1s" }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = "#1a1d27")}
                  onMouseLeave={ev => (ev.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "8px 12px", fontSize: 12, color: "#64748b" }}>{ns}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 500 }}>
                    {name}
                    {/* P3: Inline AI badge for unhealthy pods */}
                    {isBad && !aiBadges[badgeKey] && !badgeLoading[badgeKey] && (
                      <button
                        onClick={e => { e.stopPropagation(); fetchAIBadge(name, ns, status); }}
                        title="Get AI diagnosis for this pod"
                        style={{
                          marginLeft: 6, background: "#818cf822", border: "1px solid #818cf844",
                          color: "#818cf8", borderRadius: 4, padding: "1px 6px",
                          fontSize: 9, fontWeight: 700, cursor: "pointer", verticalAlign: "middle",
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

  useEffect(() => { if (tab === "ai" && resource && !aiText && !aiLoading) runAI(); }, [tab]);

  // Escape key closes modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const hasPrevLogs = resource?.data.previous && !resource.data.previous.includes("[no previous");
  const modalTabs = ["describe", "logs", ...(hasPrevLogs ? ["previous"] : []), "ai"] as const;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000088", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 10, width: 740, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #2d3148", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ background: "#4f46e533", color: "#7c8cf8", border: "1px solid #4f46e5", borderRadius: 4, padding: "2px 7px", fontSize: 11 }}>
            {loading ? "…" : resource?.kind}
          </span>
          <strong style={{ fontSize: 14 }}>{resource?.name}</strong>
          {resource?.ns && <span style={{ fontSize: 12, color: "#64748b" }}>· {resource.ns}</span>}
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#334155" }}>Esc to close</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", display: "flex", alignItems: "center", padding: 4 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
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

function parseKubectl(raw: string): { headers: string[]; rows: string[][] } {
  const lines = (raw ?? "").trim().split("\n").filter(Boolean);
  if (lines.length < 1) return { headers: [], rows: [] };
  const headers = lines[0].trim().split(/\s{2,}/).map(h =>
    h.replace(/-/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  );
  const rows = lines.slice(1).map(l => l.trim().split(/\s{2,}/));
  return { headers, rows };
}

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
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: "#0d1117" }}>
          {headers.map(h => (
            <th key={h} style={{ padding: "7px 12px", textAlign: "left", fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".4px", borderBottom: "1px solid #2d3148", whiteSpace: "nowrap" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cols, i) => (
          <tr key={i}
            onClick={() => onRowClick?.(cols, headers)}
            style={{ borderBottom: "1px solid #1a1f2e", cursor: onRowClick ? "pointer" : "default", background: i % 2 === 1 ? "#0c0e16" : "transparent", transition: "background .1s" }}
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
  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <KubectlTable raw={raw} colorFn={colorFn} />
    </div>
  );
}

// ── Services tab ──────────────────────────────────────────────────────────────

function ServicesTab({ data }: { data: Record<string, string> }) {
  const colorFn: ColorFn = (val, col) => {
    if (col.toUpperCase() === "TYPE") {
      if (val === "LoadBalancer") return "#818cf8";
      if (val === "NodePort")     return "#06b6d4";
      if (val === "ClusterIP")    return "#64748b";
    }
    return null;
  };
  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <KubectlTable raw={data.services ?? ""} colorFn={colorFn} />
    </div>
  );
}

// ── Workloads tab ─────────────────────────────────────────────────────────────

function WorkloadsTab({ data }: { data: Record<string, string> }) {
  const readyColor: ColorFn = (val, col) => {
    if (col.toUpperCase() === "READY" || col.toUpperCase() === "AVAILABLE") {
      if (val.includes("0/") || val === "0") return "#ef4444";
    }
    return null;
  };

  const sections: { label: string; key: string }[] = [
    { label: "Deployments",  key: "deployments"  },
    { label: "StatefulSets", key: "statefulsets" },
    { label: "DaemonSets",   key: "daemonsets"   },
    { label: "Jobs",         key: "jobs"         },
    { label: "CronJobs",     key: "cronjobs"     },
  ];

  return (
    <div style={{ overflowY: "auto", flex: 1, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      {sections.map(s => {
        const raw = data[s.key] ?? "";
        const hasData = raw && !raw.includes("No resources") && !raw.includes("[TIMEOUT");
        return (
          <Card key={s.key} title={s.label} defaultOpen={s.key === "deployments"}>
            {hasData
              ? <div style={{ overflowX: "auto" }}><KubectlTable raw={raw} colorFn={readyColor} /></div>
              : <div style={{ color: "#475569", fontSize: 13 }}>No {s.label.toLowerCase()} found</div>
            }
          </Card>
        );
      })}
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

  return (
    <div style={{ overflowY: "auto", flex: 1, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <Card title="Persistent Volume Claims" defaultOpen={true}>
        <div style={{ overflowX: "auto" }}><KubectlTable raw={data.pvcs ?? ""} colorFn={pvcColor} /></div>
      </Card>
      <Card title="Persistent Volumes" defaultOpen={false}>
        <div style={{ overflowX: "auto" }}><KubectlTable raw={data.pvs ?? ""} colorFn={pvcColor} /></div>
      </Card>
      <Card title="Storage Classes" defaultOpen={false}>
        <div style={{ overflowX: "auto" }}><KubectlTable raw={data.storageclasses ?? ""} /></div>
      </Card>
    </div>
  );
}

// ── Ingress tab ───────────────────────────────────────────────────────────────

function IngressTab({ data }: { data: Record<string, string> }) {
  return (
    <div style={{ overflowY: "auto", flex: 1, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <Card title="Ingresses" defaultOpen={true}>
        <div style={{ overflowX: "auto" }}><KubectlTable raw={data.ingresses ?? ""} /></div>
      </Card>
      <Card title="Ingress Classes" defaultOpen={false}>
        <div style={{ overflowX: "auto" }}><KubectlTable raw={data.ingressclasses ?? ""} /></div>
      </Card>
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
  return (
    <div style={{ overflowY: "auto", flex: 1, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      {data.services    && <Card title="Services"         defaultOpen={true} ><div style={{ overflowX: "auto" }}><KubectlTable raw={data.services}    colorFn={svcColor} /></div></Card>}
      {data.ingresses   && <Card title="Ingresses"        defaultOpen={false}><div style={{ overflowX: "auto" }}><KubectlTable raw={data.ingresses}   /></div></Card>}
      {data.netpolicies && <Card title="Network Policies" defaultOpen={false}><div style={{ overflowX: "auto" }}><KubectlTable raw={data.netpolicies} /></div></Card>}
      {data.endpoints   && <Card title="Endpoints"        defaultOpen={false}><div style={{ overflowX: "auto" }}><KubectlTable raw={data.endpoints}   /></div></Card>}
      {data.ports       && <Card title="Listening Ports"  defaultOpen={true} ><Pre>{data.ports}</Pre></Card>}
      {data.routes      && <Card title="Routes"           defaultOpen={false}><Pre>{data.routes}</Pre></Card>}
      {data.interfaces  && <Card title="Interfaces"       defaultOpen={false}><Pre>{data.interfaces}</Pre></Card>}
      {data.dns         && <Card title="DNS"              defaultOpen={false}><Pre>{data.dns}</Pre></Card>}
    </div>
  );
}

// ── Docker tabs ───────────────────────────────────────────────────────────────

function DockerContainersTab({ data }: { data: Record<string, string> }) {
  const colorFn: ColorFn = (val, col) => {
    if (col.toUpperCase() === "STATUS") {
      if (/^Up/i.test(val))   return "#22c55e";
      if (/Exited/i.test(val)) return "#ef4444";
      if (/Paused/i.test(val)) return "#f59e0b";
    }
    return null;
  };
  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <KubectlTable raw={data.output ?? ""} colorFn={colorFn} />
    </div>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function Card({ title, hint, children, defaultOpen = true }: { title: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 8, overflow: "hidden" }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ padding: "10px 14px", borderBottom: open ? "1px solid #2d3148" : "none", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#64748b" strokeWidth="1.5"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s", flexShrink: 0 }}>
          <polyline points="3,1 7,5 3,9" />
        </svg>
        {title}
        {hint && <span style={{ fontSize: 11, color: "#64748b", fontWeight: 400 }}>· {hint}</span>}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#475569" }}>{open ? "▼" : "▶"}</span>
      </div>
      {open && <div style={{ padding: "12px 14px" }}>{children}</div>}
    </div>
  );
}

function Pre({ children }: { children: ReactNode }) {
  return (
    <pre style={{ fontFamily: "'Cascadia Code','Consolas',monospace", fontSize: 12, color: "#8b949e", whiteSpace: "pre-wrap", lineHeight: 1.6, margin: 0 }}>
      {children}
    </pre>
  );
}

function LoadingSpinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, gap: 10, color: "#64748b", fontSize: 13 }}>
      <span style={{ display: "inline-block", width: 16, height: 16, border: "2px solid #2d3148", borderTopColor: "#7c8cf8", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      Loading…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

