import { useState, useEffect, useCallback } from "react";
import { LayoutGrid, ChevronRight, RefreshCw, Grid3X3, MessageSquare, Network } from "lucide-react";
import type { Target, TabId } from "../types";
import { TABS_BY_TYPE }  from "../types";
import { api }  from "../api/client";
import { TARGET_META } from "../utils/targetIcons";
import { useTargetChat } from "../hooks/useChat";
import { ChatPanel } from "../components/ChatPanel";
import { LogStream } from "../components/LogStream";
import { ResourceGraph } from "../components/ResourceGraph";
import { BTN_TRANSITION, TAB_TRANSITION, fadeInStyle } from "../utils/animations";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT, SHADOW, Z_INDEX, TIMING } from "../utils/theme";
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
  SSHServicesTab, ProcessesTab, SecurityTab,
} from "./dashboard/tabs";

interface Props {
  target: Target | null;
}

export function Dashboard({ target }: Props) {
  const [activeTab, setActiveTab]   = useState<TabId | null>(null);
  const [tabData,   setTabData]     = useState<Record<string, string>>({});
  const [tabLoading, setTabLoading] = useState(false);

  const { messages, loading: chatLoading, send, retry, edit, clear } = useTargetChat(target?.id ?? null);
  const [logStream, setLogStream] = useState<{ pod: string; namespace: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reloadTab = useCallback(() => setReloadKey(k => k + 1), []);
  const [topoNamespace, setTopoNamespace] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  // Auto-dismiss error toast after 6 seconds
  useEffect(() => {
    if (!errorToast) return;
    const t = setTimeout(() => setErrorToast(null), TIMING.toastDismiss);
    return () => clearTimeout(t);
  }, [errorToast]);

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

  // Reset tab when target changes — restore persisted tab + namespace per target
  useEffect(() => {
    if (!target) { setActiveTab(null); return; }
    const tabs = TABS_BY_TYPE[target.type];
    const savedTab = localStorage.getItem(`dashboard-tab-${target.id}`);
    const validTab = savedTab && (
      savedTab === "__chat" ||
      savedTab === "__topology" ||
      tabs.some(t => t.id === savedTab)
    );
    setActiveTab(validTab ? (savedTab as TabId) : tabs[0].id);
    setLastRefreshed(null);
    const savedNs = localStorage.getItem(`dashboard-ns-${target.id}`) ?? "";
    setNsFilter(savedNs);
    clear();
  }, [target?.id, clear]);

  // Persist active tab per target
  useEffect(() => {
    if (!target || !activeTab) return;
    localStorage.setItem(`dashboard-tab-${target.id}`, activeTab);
  }, [target?.id, activeTab]);

  // Persist namespace filter per target
  useEffect(() => {
    if (!target) return;
    if (nsFilter) localStorage.setItem(`dashboard-ns-${target.id}`, nsFilter);
    else localStorage.removeItem(`dashboard-ns-${target.id}`);
  }, [target?.id, nsFilter]);

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
        setErrorToast(`Failed to load ${activeTab}${detail}`);
      })
      .finally(() => setTabLoading(false));
  }, [target?.id, activeTab, reloadKey, nsFilter, isK8s]);

  if (!target) {
    return <NoTargetEmptyState />;
  }

  const tabs = TABS_BY_TYPE[target.type];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", margin: -1 }}>Dashboard — {target.name}</h1>

      {/* Page header */}
      <div style={{
        padding: `${SPACE.md}px ${SPACE.xl}px`,
        borderBottom: `1px solid ${C.border.muted}`,
        display: "flex",
        alignItems: "center",
        gap: SPACE.md,
        flexShrink: 0,
        background: C.bg.elevated,
      }}>
        <LayoutGrid size={16} stroke="var(--c-accent-hover)" />
        <span style={{ fontSize: FONT_SIZE.sm, color: C.text.faint, fontWeight: FONT_WEIGHT.medium }}>Dashboard</span>
        <ChevronRight size={10} stroke="var(--c-border-strong)" />
        <strong style={{ fontSize: FONT_SIZE.lg, color: C.text.primary }}>{target.name}</strong>
        <span style={{ fontSize: FONT_SIZE.md, color: C.text.muted, background: C.bg.card, padding: `${SPACE.xxs}px ${SPACE.sm}px`, borderRadius: RADIUS.sm, display: "inline-flex", alignItems: "center", gap: SPACE.xs }}>
          {(() => { const meta = TARGET_META[target.type as keyof typeof TARGET_META]; if (meta) { const Icon = meta.icon; return <Icon size={11} />; } return null; })()}
          {target.type}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: SPACE.sm }}>
          {/* Namespace selector for K8s targets */}
          {isK8s && activeTab !== "__chat" && activeTab !== "__topology" && (
            <div style={{ display: "flex", alignItems: "center", gap: SPACE.md }}>
              <Grid3X3 size={12} stroke={C.text.muted} />
              <select
                value={nsFilter}
                onChange={e => setNsFilter(e.target.value)}
                disabled={nsLoading}
                aria-label="Filter by namespace"
                style={{
                  background: C.bg.base, border: `1px solid ${C.border.muted}`, color: nsFilter ? "var(--c-accent-hover)" : C.text.secondary,
                  borderRadius: RADIUS.sm, padding: `${SPACE.xs}px ${SPACE.sm}px`, fontSize: FONT_SIZE.sm, cursor: "pointer",
                  minWidth: 140, fontWeight: nsFilter ? FONT_WEIGHT.semibold : FONT_WEIGHT.normal,
                }}
              >
                <option value="">All namespaces</option>
                {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
              </select>
            </div>
          )}
          {lastRefreshed && (
            <span style={{ fontSize: FONT_SIZE.sm, color: C.text.faint }}>
              Refreshed {Math.round((Date.now() - lastRefreshed.getTime()) / 60000) < 1
                ? "just now"
                : `${Math.round((Date.now() - lastRefreshed.getTime()) / 60000)}m ago`}
            </span>
          )}
          {activeTab && activeTab !== "__chat" && activeTab !== "__topology" && (
            <button onClick={reloadTab} disabled={tabLoading}
            className="btn-interactive"
            aria-label={tabLoading ? "Refreshing tab data" : "Refresh tab data"}
            aria-busy={tabLoading}
            title={tabLoading ? "Refreshing…" : "Refresh"}
            style={{
              background: "none", border: `1px solid ${C.border.muted}`, borderRadius: RADIUS.sm,
              color: C.text.muted, cursor: tabLoading ? "wait" : "pointer", display: "flex", alignItems: "center",
              gap: SPACE.xs, padding: `${SPACE.xs}px ${SPACE.sm}px`, fontSize: FONT_SIZE.sm, transition: BTN_TRANSITION,
              opacity: tabLoading ? 0.6 : 1,
            }}>
              <RefreshCw size={11} style={tabLoading ? { animation: "spin 0.7s linear infinite" } : undefined} />
              {tabLoading ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
      </div>

      <ContextualHint id="cmd-k">Press Cmd+K (or Ctrl+K) to search across all resources instantly.</ContextualHint>

      {/* Tab bar */}
      <div role="tablist" aria-label="Dashboard sections" style={{ display: "flex", background: C.bg.panel, borderBottom: `1px solid ${C.border.muted}`, flexShrink: 0, padding: `0 ${SPACE.md}px`, overflowX: "auto" }}>
        {tabs.map(t => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              className={active ? undefined : "hover-bg-accent-dim hover-text-primary"}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: `${SPACE.sm + 2}px ${SPACE.lg - 2}px`, fontSize: FONT_SIZE.md, border: "none", background: "transparent",
                color: active ? "var(--c-accent-hover)" : C.text.muted,
                borderBottom: active ? "2px solid var(--c-accent)" : "2px solid transparent",
                cursor: "pointer", whiteSpace: "nowrap", fontWeight: active ? FONT_WEIGHT.semibold : FONT_WEIGHT.normal,
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
          className={activeTab === "__chat" ? undefined : "hover-bg-accent-dim hover-text-primary"}
          onClick={() => setActiveTab("__chat")}
          style={{
            padding: `${SPACE.sm + 2}px ${SPACE.lg - 2}px`, fontSize: FONT_SIZE.md, border: "none", background: "transparent",
            color: activeTab === "__chat" ? "var(--c-accent-hover)" : C.text.muted,
            borderBottom: activeTab === "__chat" ? "2px solid var(--c-accent)" : "2px solid transparent",
            cursor: "pointer", whiteSpace: "nowrap",
            fontWeight: activeTab === "__chat" ? FONT_WEIGHT.semibold : FONT_WEIGHT.normal,
            display: "flex", alignItems: "center", gap: SPACE.xs,
            transition: TAB_TRANSITION,
          }}
        >
          <MessageSquare size={12} />
          AI Chat
        </button>
        {(target.type === "kubernetes" || target.type === "ssh" || target.type === "local") && (
          <button
            role="tab"
            aria-selected={activeTab === "__topology"}
            className={activeTab === "__topology" ? undefined : "hover-bg-accent-dim hover-text-primary"}
            onClick={() => setActiveTab("__topology")}
            style={{
              padding: `${SPACE.sm + 2}px ${SPACE.lg - 2}px`, fontSize: FONT_SIZE.md, border: "none", background: "transparent",
              color: activeTab === "__topology" ? "var(--c-accent-hover)" : C.text.muted,
              borderBottom: activeTab === "__topology" ? "2px solid var(--c-accent)" : "2px solid transparent",
              cursor: "pointer", whiteSpace: "nowrap",
              fontWeight: activeTab === "__topology" ? FONT_WEIGHT.semibold : FONT_WEIGHT.normal,
              display: "flex", alignItems: "center", gap: SPACE.xs,
              transition: TAB_TRANSITION,
            }}
          >
            <Network size={12} />
            Topology
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ flex: 1, overflow: "hidden", display: "flex", minHeight: 0 }}>
          {activeTab === "__chat" ? (
            <div key="__chat" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, ...fadeInStyle }}>
              <ContextualHint id="chat-intro">Ask anything — "which pods are failing?", "show me memory usage", "why is nginx crashing?"</ContextualHint>
              <ChatPanel
                messages={messages}
                loading={chatLoading}
                onSend={send}
                onRetry={retry}
                onEdit={edit}
                placeholder={`Ask about ${target.name}…`}
                targetId={target.id}
              />
            </div>
          ) : activeTab === "__topology" ? (
            <div key="__topology" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, ...fadeInStyle }}>
              <div style={{ padding: `${SPACE.sm}px ${SPACE.lg}px`, borderBottom: `1px solid ${C.border.muted}`, display: "flex", alignItems: "center", gap: SPACE.sm, background: C.bg.panel, flexShrink: 0 }}>
                <label style={{ fontSize: FONT_SIZE.sm, color: C.text.muted }}>Namespace</label>
                <input
                  value={topoNamespace}
                  onChange={e => setTopoNamespace(e.target.value)}
                  placeholder="all namespaces"
                  style={{ background: "var(--c-bg-surface)", border: `1px solid ${C.border.muted}`, color: C.text.primary, borderRadius: RADIUS.sm, padding: `3px ${SPACE.sm}px`, fontSize: FONT_SIZE.sm, width: 180 }}
                />
              </div>
              <ContextualHint id="topology-click">Click any node to inspect its details, logs, and run an AI diagnosis.</ContextualHint>
              <ResourceGraph target={target} namespace={topoNamespace} />
            </div>
          ) : (
            <div key={activeTab} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, ...fadeInStyle }}>
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

        {/* Error toast (auto-dismiss) */}
        {errorToast && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              position: "fixed", bottom: SPACE.xl, right: SPACE.xl, zIndex: Z_INDEX.toast,
              background: C.error.bg, border: "1px solid var(--c-sev1)",
              borderRadius: RADIUS.lg, padding: `${SPACE.sm + 2}px ${SPACE.lg - 2}px`, fontSize: FONT_SIZE.md,
              color: "var(--c-sev1)", maxWidth: 380,
              boxShadow: SHADOW.lg,
              display: "flex", alignItems: "flex-start", gap: SPACE.sm + 2,
              animation: "fadeIn .25s ease-out",
            }}
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span style={{ flex: 1 }}>{errorToast}</span>
            <button
              onClick={() => setErrorToast(null)}
              aria-label="Dismiss"
              style={{ background: "none", border: "none", color: "var(--c-sev1)", cursor: "pointer", fontSize: FONT_SIZE.lg, lineHeight: 1, padding: 0, flexShrink: 0 }}
            >×</button>
          </div>
        )}

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

/**
 * Routes a `tabId` to the correct tab component based on the target's type.
 *
 * Special cases handled here (not in the lookup below):
 * - `loading` → per-tab `SkeletonLoader` variant (cards/table/mixed)
 * - `null` tabId or missing target → nothing
 * - `data.error` set → inline error card with a retry button
 * - Virtual tabs (__chat, __topology) are handled by Dashboard itself and
 *   never reach this component.
 *
 * Add new tabs by mapping `(target.type, tabId)` to a component below.
 */
function TabContent({ tabId, data, loading, target, onStreamLogs, onRetry }: TabContentProps) {
  if (loading) {
    const ttype = target.type;
    const isCardsTab = (ttype === "ssh" || ttype === "local") && tabId === "overview";
    const isTableTab = tabId === "pods" || tabId === "nodes" || tabId === "services"
      || tabId === "events" || tabId === "ingress" || tabId === "containers"
      || tabId === "volumes" || tabId === "images" || tabId === "stats";
    const variant = isCardsTab ? "cards" : isTableTab ? "table" : "mixed";
    return <SkeletonLoader variant={variant} />;
  }
  if (!tabId)  return null;

  if (data.error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: SPACE.md, ...fadeInStyle }}>
        <div style={{ background: C.error.bg, border: "1px solid var(--c-sev1)", borderRadius: RADIUS.lg, padding: `${SPACE.lg - 2}px ${SPACE.xl}px`, fontSize: FONT_SIZE.md, color: "var(--c-sev1)", maxWidth: 480, textAlign: "center" }}>
          {data.error}
        </div>
        {onRetry && (
          <button onClick={onRetry}
          className="btn-interactive"
          style={{
            display: "flex", alignItems: "center", gap: SPACE.md,
            background: C.bg.card, border: `1px solid ${C.border.muted}`,
            color: C.text.secondary, borderRadius: RADIUS.md, padding: `${SPACE.md}px ${SPACE.lg - 2}px`,
            fontSize: FONT_SIZE.md, cursor: "pointer", transition: BTN_TRANSITION,
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

  // SSH/local specific tabs — must come before K8s "services" check
  if ((ttype === "ssh" || ttype === "local") && tabId === "services")
    return <SSHServicesTab data={data} target={target} />;
  if (tabId === "processes") return <ProcessesTab data={data} />;
  if (tabId === "security")  return <SecurityTab data={data} />;

  // Overview — rich metric cards for SSH/local
  if ((ttype === "ssh" || ttype === "local") && tabId === "overview") {
    return <OverviewTab data={data} targetId={target.id} />;
  }

  // Nodes — cluster-scoped, separate parser
  if (ttype === "kubernetes" && tabId === "nodes") {
    return <NodeTable raw={data.output ?? ""} target={target} />;
  }

  // Pods — clickable table
  if (tabId === "pods") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <ContextualHint id="pods-diagnose">Unhealthy pods show a Diagnose button — click it for an instant AI diagnosis without opening chat.</ContextualHint>
        <PodTable raw={data.pods ?? data.output ?? ""} target={target} onStreamLogs={onStreamLogs} />
      </div>
    );
  }

  // Logs — colorized
  if (tabId === "logs") {
    return <LogsTab raw={data.logs ?? ""} target={target} />;
  }

  // Kubernetes rich tabs
  if (tabId === "events")      return <EventsTab      data={data} target={target} />;
  if (tabId === "services")    return <ServicesTab    data={data} target={target} />;
  if (tabId === "workloads")   return <WorkloadsTab   data={data} target={target} />;
  if (tabId === "k8s_storage") return <K8sStorageTab  data={data} target={target} />;
  if (tabId === "ingress")     return <IngressTab     data={data} target={target} />;
  if (tabId === "network")     return <NetworkTab     data={data} target={target} />;

  // Docker rich tabs
  if (tabId === "containers")  return <DockerContainersTab data={data} target={target} />;
  if (tabId === "volumes")     return <DockerVolumesTab data={data} target={target} />;
  if (tabId === "images")      return <DockerImagesTab data={data} target={target} />;
  if (tabId === "stats")       return <DockerStatsTab data={data} target={target} />;

  // Generic — card-per-key
  return <GenericTab data={data} />;
}

