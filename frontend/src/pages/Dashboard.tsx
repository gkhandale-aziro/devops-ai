import { useState, useEffect, useCallback } from "react";
import type { Target } from "../types";
import { TABS_BY_TYPE }  from "../types";
import { api }  from "../api/client";
import { useTargetChat } from "../hooks/useChat";
import { ChatPanel } from "../components/ChatPanel";
import { LogStream } from "../components/LogStream";
import { ResourceGraph } from "../components/ResourceGraph";
import { BTN_TRANSITION, btnHoverStyle, btnActiveStyle, TAB_TRANSITION, tabHoverStyle, fadeInStyle } from "../utils/animations";
import {
  NoTargetEmptyState, ContextualHint, SkeletonLoader,
} from "./dashboard/primitives";
import {
  NodeTable, PodTable, LogsTab,
} from "./dashboard/tables";
import {
  OverviewTab, GenericTab, EventsTab, ServicesTab, WorkloadsTab,
  K8sStorageTab, IngressTab, NetworkTab,
  DockerContainersTab, DockerVolumesTab, DockerImagesTab, DockerStatsTab,
} from "./dashboard/tabs";

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
                aria-label="Filter by namespace"
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

