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

  // Reset tab when target changes
  useEffect(() => {
    if (!target) { setActiveTab(null); return; }
    const tabs = TABS_BY_TYPE[target.type];
    setActiveTab(tabs[0].id);
    clear();
  }, [target?.id]);

  // Load tab data when tab changes (skip for chat tab)
  useEffect(() => {
    if (!target || !activeTab || activeTab === "__chat") return;
    setTabLoading(true);
    setTabData({});
    api.tab(target.id, activeTab)
      .then(setTabData)
      .catch(() => setTabData({ error: "Failed to load" }))
      .finally(() => setTabLoading(false));
  }, [target?.id, activeTab]);

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
        <strong style={{ fontSize: 15 }}>{target.name}</strong>
        <span style={{ fontSize: 12, color: "#64748b", background: "#1a1d27", padding: "2px 8px", borderRadius: 4 }}>{target.type}</span>
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
            cursor: "pointer", whiteSpace: "nowrap", marginLeft: "auto",
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
            <ResourceGraph target={target} namespace="" />
          ) : (
            <TabContent
              tabId={activeTab}
              data={tabData}
              loading={tabLoading}
              target={target}
              onStreamLogs={(pod, namespace) => setLogStream({ pod, namespace })}
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
}

function TabContent({ tabId, data, loading, target, onStreamLogs }: TabContentProps) {
  if (loading) return <LoadingSpinner />;
  if (!tabId)  return null;

  if (data.error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
        <div style={{ background: "#2a0011", border: "1px solid #f43f5e", borderRadius: 8, padding: "14px 20px", fontSize: 13, color: "#fb7185", maxWidth: 480, textAlign: "center" }}>
          {data.error}
        </div>
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
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--c-border,#1a2235)", display: "flex", gap: 8, flexShrink: 0, alignItems: "center", background: "var(--c-bg-surface,#0a0f1e)" }}>
        <select
          value={nsFilter}
          onChange={e => setNsFilter(e.target.value)}
          style={{ background: "var(--c-bg-raised,#0f1629)", border: "1px solid var(--c-border-strong,#263050)", color: "var(--c-text-primary,#f1f5f9)", borderRadius: 7, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}
        >
          <option value="">All namespaces</option>
          {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
        </select>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search pods…"
          style={{ background: "var(--c-bg-raised,#0f1629)", border: "1px solid var(--c-border-strong,#263050)", color: "var(--c-text-primary,#f1f5f9)", borderRadius: 7, padding: "6px 10px", fontSize: 12, flex: 1 }}
        />
        <span style={{ fontSize: 11, color: "var(--c-text-faint,#475569)", whiteSpace: "nowrap" }}>
          <strong style={{ color: "var(--c-text-muted,#64748b)", fontWeight: 600 }}>{lines.length}</strong> pod{lines.length !== 1 ? "s" : ""} · click row for details
        </span>
      </div>

      {/* table */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--c-bg-surface,#0a0f1e)", position: "sticky", top: 0, zIndex: 1 }}>
              {["Namespace","Name","Ready","Status","Restarts","Age",""].map(h => (
                <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "var(--c-text-muted,#64748b)", textTransform: "uppercase", letterSpacing: ".6px", borderBottom: "1px solid var(--c-border,#1a2235)" }}>{h}</th>
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
                  style={{ cursor: "pointer", transition: "background .12s", borderBottom: i % 2 === 0 ? "none" : "none" }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = "var(--c-bg-raised,#0f1629)")}
                  onMouseLeave={ev => (ev.currentTarget.style.background = i % 2 === 0 ? "transparent" : "var(--c-bg-surface,#0a0f1e)")}
                >
                  {/* Namespace — tertiary, muted */}
                  <td style={{ padding: "10px 14px", fontSize: 11, color: "var(--c-text-faint,#475569)", fontWeight: 500 }}>{ns}</td>
                  {/* Name — primary, bold */}
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text-primary,#f1f5f9)" }}>{name}</span>
                    {/* P3: Inline AI badge for unhealthy pods */}
                    {isBad && !aiBadges[badgeKey] && !badgeLoading[badgeKey] && (
                      <button
                        onClick={e => { e.stopPropagation(); fetchAIBadge(name, ns, status); }}
                        title="Get AI diagnosis"
                        style={{
                          marginLeft: 7, background: "#818cf818", border: "1px solid #818cf833",
                          color: "#818cf8", borderRadius: 5, padding: "2px 7px",
                          fontSize: 10, fontWeight: 700, cursor: "pointer", verticalAlign: "middle",
                          transition: "all .15s",
                        }}
                      >
                        ✦ AI
                      </button>
                    )}
                    {badgeLoading[badgeKey] && (
                      <span style={{ marginLeft: 7, fontSize: 10, color: "#818cf8", fontStyle: "italic" }}>analyzing…</span>
                    )}
                    {aiBadges[badgeKey] && (
                      <div style={{
                        marginTop: 5, fontSize: 11, color: "#a5b4fc", lineHeight: 1.5,
                        background: "#6366f110", border: "1px solid #6366f133",
                        borderRadius: 6, padding: "5px 10px", maxWidth: 420,
                      }}>
                        <span style={{ color: "#818cf8", fontWeight: 700 }}>✦ </span>{aiBadges[badgeKey]}
                      </div>
                    )}
                  </td>
                  {/* Ready — secondary */}
                  <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--c-text-secondary,#94a3b8)" }}>{ready}</td>
                  {/* Status badge */}
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ background: sc + "18", color: sc, border: `1px solid ${sc}33`, borderRadius: 5, padding: "3px 8px", fontSize: 11, fontWeight: 700 }}>
                      {status}
                    </span>
                  </td>
                  {/* Restarts — color-coded weight */}
                  <td style={{ padding: "10px 14px", fontSize: 12, fontWeight: +restarts > 5 ? 700 : 400, color: +restarts > 5 ? "#f59e0b" : +restarts > 0 ? "var(--c-text-secondary,#94a3b8)" : "var(--c-text-faint,#475569)" }}>
                    {restarts}
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--c-text-faint,#475569)" }}>{c[c.length - 1]}</td>
                  {/* Logs — SVG icon button */}
                  <td style={{ padding: "10px 14px" }}>
                    {onStreamLogs && (
                      <button
                        onClick={e => { e.stopPropagation(); onStreamLogs(name, ns); }}
                        title="Stream logs"
                        style={{
                          background: "#06b6d412", border: "1px solid #06b6d433",
                          color: "#06b6d4", borderRadius: 6, padding: "4px 9px",
                          fontSize: 11, fontWeight: 600, cursor: "pointer",
                          display: "inline-flex", alignItems: "center", gap: 4,
                          transition: "all .15s",
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#06b6d422"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#06b6d412"; }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5,3 19,12 5,21"/>
                        </svg>
                        Logs
                      </button>
                    )}
                  </td>
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

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "#000000aa", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: "var(--c-bg-raised, #0f1629)",
        border: "1px solid var(--c-border-strong, #263050)",
        borderRadius: 14,
        boxShadow: "0 24px 80px #000000aa, 0 4px 24px #00000066",
        width: 760, maxHeight: "82vh",
        display: "flex", flexDirection: "column",
        animation: "fadeIn .18s ease-out",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--c-border, #1a2235)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ background: "#4f46e522", color: "#818cf8", border: "1px solid #4f46e544", borderRadius: 6, padding: "3px 9px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
            {loading ? "…" : resource?.kind}
          </span>
          <strong style={{ fontSize: 15, fontWeight: 700, color: "var(--c-text-primary,#f1f5f9)", letterSpacing: "-.2px" }}>{resource?.name}</strong>
          {resource?.ns && <span style={{ fontSize: 12, color: "var(--c-text-muted,#64748b)", fontWeight: 500 }}>/ {resource.ns}</span>}
          {/* SVG close — no emoji */}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ marginLeft: "auto", background: "var(--c-bg-overlay,#182035)", border: "1px solid var(--c-border,#1a2235)", color: "var(--c-text-muted,#64748b)", width: 28, height: 28, borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#f43f5e44"; (e.currentTarget as HTMLElement).style.color = "#f43f5e"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--c-border,#1a2235)"; (e.currentTarget as HTMLElement).style.color = "var(--c-text-muted,#64748b)"; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        {!loading && resource && (
          <>
            {/* Tab bar */}
            <div style={{ display: "flex", borderBottom: "1px solid var(--c-border,#1a2235)", padding: "0 20px", background: "var(--c-bg-surface,#0a0f1e)" }}>
              {(["describe", "logs", "previous", "ai"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding: "10px 16px", fontSize: 12, fontWeight: tab === t ? 600 : 400,
                  background: "none", border: "none",
                  color: tab === t ? "#818cf8" : "var(--c-text-muted,#64748b)",
                  borderBottom: tab === t ? "2px solid #6366f1" : "2px solid transparent",
                  cursor: "pointer", transition: "color .15s", whiteSpace: "nowrap",
                }}>{t === "previous" ? "Prev Logs" : t === "ai" ? "AI Analysis" : t.charAt(0).toUpperCase() + t.slice(1)}</button>
              ))}
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "18px 20px" }}>
              {tab === "ai"
                ? (aiLoading ? <LoadingSpinner /> : <div style={{ fontSize: 13, lineHeight: 1.85, whiteSpace: "pre-wrap", color: "var(--c-text-secondary,#94a3b8)" }}>{aiText}</div>)
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

// ── Shared primitives ─────────────────────────────────────────────────────────

function Card({ title, hint, children, defaultOpen = true }: { title: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: "var(--c-bg-raised, #0f1629)",
      border: "1px solid var(--c-border, #1a2235)",
      borderRadius: 10, overflow: "hidden",
      boxShadow: "0 2px 8px #00000033",
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: "11px 16px",
          borderBottom: open ? "1px solid var(--c-border, #1a2235)" : "none",
          display: "flex", alignItems: "center", gap: 8,
          cursor: "pointer", userSelect: "none",
        }}
      >
        {/* Chevron — SVG only, no emoji */}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--c-text-muted,#64748b)" strokeWidth="1.8"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .2s", flexShrink: 0 }}>
          <polyline points="3,1 7,5 3,9" />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text-primary,#f1f5f9)", letterSpacing: "-.1px", flex: 1 }}>
          {title}
        </span>
        {hint && (
          <span style={{ fontSize: 11, color: "var(--c-text-muted,#64748b)", fontWeight: 400, background: "var(--c-bg-overlay,#182035)", padding: "1px 6px", borderRadius: 4 }}>
            {hint}
          </span>
        )}
      </div>
      {open && <div style={{ padding: "14px 16px" }}>{children}</div>}
    </div>
  );
}

function Pre({ children }: { children: ReactNode }) {
  return (
    <pre className="mono" style={{ fontSize: 12, color: "#8b949e", whiteSpace: "pre-wrap", lineHeight: 1.7, margin: 0 }}>
      {children}
    </pre>
  );
}

function LoadingSpinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, gap: 10, color: "var(--c-text-muted,#64748b)", fontSize: 13 }}>
      <span style={{ display: "inline-block", width: 16, height: 16, border: "2px solid var(--c-border,#1a2235)", borderTopColor: "var(--c-accent,#6366f1)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      Loading…
    </div>
  );
}

