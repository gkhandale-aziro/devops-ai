import { useState, useEffect, useCallback, type ReactNode } from "react";
import type { Target } from "../types";
import { TABS_BY_TYPE }  from "../types";
import { api, readSSE }  from "../api/client";
import { useTargetChat } from "../hooks/useChat";
import { ChatPanel }     from "../components/ChatPanel";

interface Props {
  target: Target | null;
}

export function Dashboard({ target }: Props) {
  const [activeTab, setActiveTab]   = useState<string | null>(null);
  const [tabData,   setTabData]     = useState<Record<string, string>>({});
  const [tabLoading, setTabLoading] = useState(false);

  const { messages, loading: chatLoading, send, clear } = useTargetChat(target?.id ?? null);

  // Reset tab when target changes
  useEffect(() => {
    if (!target) { setActiveTab(null); return; }
    const tabs = TABS_BY_TYPE[target.type];
    setActiveTab(tabs[0].id);
    clear();
  }, [target?.id]);

  // Load tab data when tab changes
  useEffect(() => {
    if (!target || !activeTab || activeTab === "chat") return;
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
      {/* Tab bar */}
      <div style={{ display: "flex", background: "#0d1117", borderBottom: "1px solid #2d3148", flexShrink: 0 }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: "10px 16px", fontSize: 12, border: "none", background: "transparent",
              color: activeTab === t.id ? "#7c8cf8" : "#64748b",
              borderBottom: activeTab === t.id ? "2px solid #7c8cf8" : "2px solid transparent",
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            {t.label}
          </button>
        ))}
        {/* chat always appended */}
        <button
          onClick={() => setActiveTab("chat")}
          style={{
            padding: "10px 16px", fontSize: 12, border: "none", background: "transparent",
            color: activeTab === "chat" ? "#7c8cf8" : "#64748b",
            borderBottom: activeTab === "chat" ? "2px solid #7c8cf8" : "2px solid transparent",
            cursor: "pointer", marginLeft: "auto",
          }}
        >
          💬 AI Chat
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {activeTab === "chat" ? (
          <ChatPanel messages={messages} loading={chatLoading} onSend={send} placeholder={`Ask about ${target.name}…`} />
        ) : (
          <TabContent
            tabId={activeTab}
            data={tabData}
            loading={tabLoading}
            target={target}
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
}

function TabContent({ tabId, data, loading, target }: TabContentProps) {
  if (loading) return <LoadingSpinner />;
  if (!tabId)  return null;

  const ttype = target.type;

  // Overview — rich metric cards for SSH/local
  if ((ttype === "ssh" || ttype === "local") && tabId === "overview") {
    return <OverviewTab data={data} />;
  }

  // Pods — clickable table
  if (tabId === "pods" || (ttype === "kubernetes" && tabId === "nodes")) {
    return <PodTable raw={data.pods ?? data.output ?? ""} target={target} />;
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

// ── Pod table ─────────────────────────────────────────────────────────────────

function PodTable({ raw, target }: { raw: string; target: Target }) {
  const [resource,  setResource]  = useState<{ kind: string; name: string; ns: string; data: Record<string, string> } | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [nsFilter,  setNsFilter]  = useState("");
  const [search,    setSearch]    = useState("");

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
        <span style={{ fontSize: 11, color: "#64748b", alignSelf: "center" }}>
          {lines.length} pod{lines.length !== 1 ? "s" : ""} · click row for Describe / Logs / AI
        </span>
      </div>

      {/* table */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#0d1117", position: "sticky", top: 0 }}>
              {["Namespace","Name","Ready","Status","Restarts","Age"].map(h => (
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
              return (
                <tr key={i} onClick={() => openResource("pod", name, ns)}
                  style={{ borderBottom: "1px solid #1e2130", cursor: "pointer", transition: "background .1s" }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = "#1a1d27")}
                  onMouseLeave={ev => (ev.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "8px 12px", fontSize: 12, color: "#64748b" }}>{ns}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 500 }}>{name}</td>
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

function ResourceModal({ resource, loading, targetId, onClose }: {
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
    <div style={{ position: "fixed", inset: 0, background: "#00000088", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 10, width: 740, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #2d3148", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ background: "#4f46e533", color: "#7c8cf8", border: "1px solid #4f46e5", borderRadius: 4, padding: "2px 7px", fontSize: 11 }}>
            {loading ? "…" : resource?.kind}
          </span>
          <strong style={{ fontSize: 14 }}>{resource?.name}</strong>
          {resource?.ns && <span style={{ fontSize: 12, color: "#64748b" }}>· {resource.ns}</span>}
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        {!loading && resource && (
          <>
            <div style={{ display: "flex", borderBottom: "1px solid #2d3148", padding: "0 16px" }}>
              {(["describe", "logs", "previous", "ai"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding: "8px 14px", fontSize: 12, background: "none", border: "none",
                  color: tab === t ? "#7c8cf8" : "#64748b", borderBottom: tab === t ? "2px solid #7c8cf8" : "2px solid transparent",
                  cursor: "pointer", textTransform: "capitalize",
                }}>{t === "previous" ? "Prev Logs" : t === "ai" ? "AI Analysis" : t}</button>
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
  const [content, setContent] = useState(raw);
  const load = (unit: string) => {
    api.tab(target.id, "logs", unit ? { unit } : {}).then(d => setContent(d.logs ?? ""));
  };
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #2d3148", display: "flex", gap: 8 }}>
        {["", "kubelet", "containerd", "ssh"].map(u => (
          <button key={u} onClick={() => load(u)} style={{ background: "#1a1d27", border: "1px solid #2d3148", color: "#94a3b8", borderRadius: 4, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>
            {u || "All"}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        <Pre>{content}</Pre>
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

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #2d3148", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
        {title}
        {hint && <span style={{ fontSize: 11, color: "#64748b", fontWeight: 400 }}>· {hint}</span>}
      </div>
      <div style={{ padding: "12px 14px" }}>{children}</div>
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

