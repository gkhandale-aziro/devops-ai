/**
 * dashboard/tables.tsx — table + modal components extracted from Dashboard.tsx.
 *
 * Each component is responsible for one section of the dashboard view:
 *   NodeTable     — node listing with click-to-detail modal
 *   PodTable      — pod listing with namespace/search filter, AI badge, modal
 *   KubectlTable  — generic 2D kubectl-output renderer used by many tabs
 *   ResourceModal — describe/logs/previous/AI tabs for a single resource
 *   LogsTab       — log filter/viewer for SSH targets
 *
 * These were inline in Dashboard.tsx (1578 lines). Moving them out shrinks
 * the page shell and lets each piece be tested in isolation.
 */
import {
  useState, useEffect, useCallback, useMemo, useRef, useDeferredValue,
  type MouseEvent,
} from "react";
import type { Target, PodStatus } from "../../types";
import { api, readSSE } from "../../api/client";
import { parseKubectl } from "../../utils/parseKubectl";
import { Pre, LoadingSpinner, PodSummaryBar } from "./primitives";
import { C } from "../../utils/theme";

// ── Node table ──────────────────────────────────────────────────────────────

const nodeStatusColor = (s: string) => s === "Ready" ? C.status.success : C.status.danger;

/**
 * Cluster node listing — parses `kubectl get nodes` output and renders it as
 * a clickable table. Row clicks open a ResourceModal with `kubectl describe
 * node`. Handles both `-A` and `-n <ns>` shaped output (node is cluster-scoped
 * so no namespace column).
 */
export function NodeTable({ raw, target }: { raw: string; target: Target }) {
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
    return <div style={{ padding: 20, color: C.text.muted, fontSize: 13 }}>kubectl not available or no nodes found.</div>;
  }
  if (allLines.length < 2) return <Pre>{raw}</Pre>;

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: C.bg.base, position: "sticky", top: 0 }}>
            {["Name", "Status", "Roles", "Age", "Version", "Internal IP"].map(h => (
              <th key={h} style={{ padding: "7px 12px", textAlign: "left", fontSize: 11, color: C.text.muted, textTransform: "uppercase", borderBottom: `1px solid ${C.border.muted}` }}>{h}</th>
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
                onMouseEnter={(ev: MouseEvent<HTMLTableRowElement>) => (ev.currentTarget.style.background = C.bg.card)}
                onMouseLeave={(ev: MouseEvent<HTMLTableRowElement>) => (ev.currentTarget.style.background = "transparent")}
              >
                <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 500 }}>{name}</td>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{ background: sc + "22", color: sc, border: `1px solid ${sc}44`, borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 600 }}>{status}</span>
                </td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: C.text.secondary }}>{roles}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: C.text.muted }}>{age}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: C.text.muted }}>{version ?? "—"}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: C.text.muted }}>{internalIp ?? "—"}</td>
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

/** Statuses considered failing — used for row tint, summary counts, AI badge.
 *  Typed as Set<string> for .has(arbitraryString) ergonomics, but literal
 *  values are checked against `PodStatus` via `satisfies`. */
const POD_BAD_STATUSES: ReadonlySet<string> = new Set([
  "CrashLoopBackOff", "Error", "OOMKilled", "ImagePullBackOff",
  "ErrImagePull", "CreateContainerConfigError", "Failed", "Init:Error",
] satisfies PodStatus[]);

/** Maps a pod status string → display color. Accepts any string since kubectl
 *  may emit values outside the known `PodStatus` union (e.g. custom reasons). */
const podStatusColor = (s: string): string =>
  s === "Running" || s === "Succeeded" || s === "Completed" ? C.status.success
  : s.includes("Error") || s.includes("Crash") || s === "OOMKilled" || s === "Failed" ? C.status.danger
  : C.status.warning;

/**
 * Pod listing with namespace filter, search, AI badge, and modal.
 *
 * Features:
 * - Summary bar (running/pending/bad) derived from `POD_BAD_STATUSES`
 * - Namespace dropdown (derived from visible rows)
 * - Full-text search across name/ns/status
 * - Unhealthy rows get a red tint + left accent (visual polish batch)
 * - Keyboard nav: ↑/↓ moves focus, Enter opens the ResourceModal
 * - AI "Diagnose" badge button on bad pods → calls /analyze for a 1-line
 *   summary, cached per `${ns}/${name}` key
 *
 * @param onStreamLogs Optional callback — when set, each row shows a "Logs"
 *                     button that streams container output to the LogStream tray.
 */
export function PodTable({ raw, target, onStreamLogs }: { raw: string; target: Target; onStreamLogs?: (pod: string, ns: string) => void }) {
  const [resource,     setResource]     = useState<{ kind: string; name: string; ns: string; data: Record<string, string> } | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [nsFilter,     setNsFilter]     = useState("");
  const [search,       setSearch]       = useState("");
  const [aiBadges,     setAiBadges]     = useState<Record<string, string>>({});
  const [badgeLoading, setBadgeLoading] = useState<Record<string, boolean>>({});

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

  // Note: hooks below are intentionally before the early-return guards so the
  // hook order stays stable. The early returns originally lived above
  // podCounts in Dashboard.tsx — moving them up was a latent React rules-of-
  // hooks bug; this version follows the rule.
  const podCounts = useMemo(() => {
    const counts = { running: 0, pending: 0, bad: 0, total: 0 };
    allLines.slice(1).forEach(line => {
      const c = line.trim().split(/\s+/);
      if (c.length < 4) return;
      const status = c[3];
      counts.total++;
      if (status === "Running")              counts.running++;
      else if (status === "Pending")         counts.pending++;
      else if (POD_BAD_STATUSES.has(status)) counts.bad++;
    });
    return counts;
  }, [allLines]);

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
    return <div style={{ padding: 20, color: C.text.muted, fontSize: 13 }}>kubectl not available or no pods found.</div>;
  }
  if (allLines.length < 2) return <Pre>{raw}</Pre>;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {podCounts.total > 0 && <PodSummaryBar counts={podCounts} />}
      <div style={{ padding: "8px 16px", background: "#0d1017", display: "flex", gap: 8, flexShrink: 0 }}>
        <select
          value={nsFilter}
          onChange={e => setNsFilter(e.target.value)}
          style={{ background: "#0f1117", border: `1px solid ${C.border.muted}`, color: C.text.primary, borderRadius: 6, padding: "5px 10px", fontSize: 12 }}
        >
          <option value="">All namespaces</option>
          {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
        </select>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search pods…"
          style={{ background: "#0f1117", border: `1px solid ${C.border.muted}`, color: C.text.primary, borderRadius: 6, padding: "5px 10px", fontSize: 12, flex: 1 }}
        />
        <span style={{ fontSize: 11, color: C.text.faint, alignSelf: "center" }}>
          {lines.length} pod{lines.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.bg.base, position: "sticky", top: 0 }}>
              {["Namespace","Name","Ready","Status","Restarts","Age","",""].map(h => (
                <th key={h} style={{ padding: "7px 12px", textAlign: "left", fontSize: 11, color: C.text.muted, textTransform: "uppercase", borderBottom: `1px solid ${C.border.muted}` }}>{h}</th>
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
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openResource("pod", name, ns); }
                    else if (ev.key === "ArrowDown") {
                      ev.preventDefault();
                      const next = ev.currentTarget.nextElementSibling as HTMLElement | null;
                      next?.focus?.();
                    } else if (ev.key === "ArrowUp") {
                      ev.preventDefault();
                      const prev = ev.currentTarget.previousElementSibling as HTMLElement | null;
                      prev?.focus?.();
                    }
                  }}
                  style={{
                    cursor: "pointer",
                    transition: "background .1s",
                    background: isBad ? `${C.status.danger}10` : "transparent",
                    borderLeft: isBad ? `2px solid ${C.status.danger}` : "2px solid transparent",
                  }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = isBad ? `${C.status.danger}20` : C.bg.card)}
                  onMouseLeave={ev => (ev.currentTarget.style.background = isBad ? `${C.status.danger}10` : "transparent")}
                >
                  <td style={{ padding: "8px 12px", fontSize: 12, color: C.text.muted }}>{ns}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>
                    {name}
                    {isBad && !aiBadges[badgeKey] && !badgeLoading[badgeKey] && (
                      <button
                        onClick={e => { e.stopPropagation(); fetchAIBadge(name, ns, status); }}
                        aria-label={`Diagnose pod ${name}`}
                        title="Get AI diagnosis for this pod"
                        style={{
                          marginLeft: 6, background: `${C.accent.light}22`, border: `1px solid ${C.accent.light}44`,
                          color: C.accent.light, borderRadius: 4, padding: "2px 7px",
                          fontSize: 11, fontWeight: 600, cursor: "pointer", verticalAlign: "middle",
                        }}
                      >
                        ✦ Diagnose
                      </button>
                    )}
                    {badgeLoading[badgeKey] && (
                      <span style={{ marginLeft: 6, fontSize: 9, color: C.accent.light }}>analyzing…</span>
                    )}
                    {aiBadges[badgeKey] && (
                      <div style={{
                        marginTop: 3, fontSize: 10, color: "#a5b4fc", lineHeight: 1.4,
                        background: "#1e2240", border: `1px solid ${C.accent.primary}33`,
                        borderRadius: 4, padding: "3px 7px", maxWidth: 400,
                      }}>
                        ✦ {aiBadges[badgeKey]}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 12, color: C.text.muted }}>{ready}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ background: sc + "22", color: sc, border: `1px solid ${sc}44`, borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 600 }}>
                      {status}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 12, color: +restarts > 5 ? C.status.warning : +restarts > 0 ? C.text.secondary : C.text.muted }}>
                    {restarts}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 12, color: C.text.muted }}>{c[c.length - 1]}</td>
                  <td style={{ padding: "8px 12px" }}>
                    {onStreamLogs && (
                      <button
                        onClick={e => { e.stopPropagation(); onStreamLogs(name, ns); }}
                        aria-label={`Stream live logs for pod ${name}`}
                        title="Stream live logs"
                        style={{
                          background: `${C.status.info}22`, border: `1px solid ${C.status.info}44`,
                          color: C.status.info, borderRadius: 4, padding: "2px 7px",
                          fontSize: 10, fontWeight: 600, cursor: "pointer",
                        }}
                      >
                        ▶ Logs
                      </button>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px", color: C.text.dim, textAlign: "right" }}>›</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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

// ── Resource detail modal ───────────────────────────────────────────────────

export function ResourceModal({ resource, loading, targetId: _targetId, onClose }: {
  resource: { kind: string; name: string; ns: string; data: Record<string, string> } | null;
  loading:  boolean;
  targetId: string;
  onClose:  () => void;
}) {
  const [tab, setTab] = useState<"describe" | "logs" | "previous" | "ai">("describe");
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const dialogRef  = useRef<HTMLDivElement>(null);
  const openerRef  = useRef<HTMLElement | null>(null);

  // Remember what was focused when the modal mounted, restore on unmount,
  // and move initial focus into the dialog for keyboard users.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => { openerRef.current?.focus?.(); };
  }, []);

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
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="modal-title"
           onKeyDown={e => {
             // Simple focus trap — keep Tab inside the dialog subtree.
             if (e.key !== "Tab" || !dialogRef.current) return;
             const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
               'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
             );
             if (!focusables.length) return;
             const first = focusables[0];
             const last  = focusables[focusables.length - 1];
             if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
             else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
           }}
           style={{ background: C.bg.card, border: `1px solid ${C.border.muted}`, borderRadius: 12, width: 740, maxHeight: "82vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,.6), 0 4px 16px rgba(0,0,0,.4)", outline: "none" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border.muted}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ background: "#4f46e533", color: "#7c8cf8", border: "1px solid #4f46e5", borderRadius: 4, padding: "2px 7px", fontSize: 11 }}>
            {loading ? "…" : resource?.kind}
          </span>
          <strong id="modal-title" style={{ fontSize: 14 }}>{resource?.name}</strong>
          {resource?.ns && <span style={{ fontSize: 12, color: C.text.muted }}>· {resource.ns}</span>}
          <span style={{ marginLeft: "auto", fontSize: 10, color: C.text.faint }}>Esc to close</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: C.text.muted, cursor: "pointer", display: "flex", alignItems: "center", padding: 4 }}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        {!loading && resource && (
          <>
            <div style={{ display: "flex", borderBottom: `1px solid ${C.border.muted}`, padding: "0 16px" }}>
              {modalTabs.map(t => (
                <button key={t} onClick={() => setTab(t as typeof tab)} style={{
                  padding: "8px 14px", fontSize: 12, background: "none", border: "none",
                  color: tab === t ? "#7c8cf8" : C.text.muted, borderBottom: tab === t ? "2px solid #7c8cf8" : "2px solid transparent",
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

// ── Logs tab ────────────────────────────────────────────────────────────────

/**
 * Aggregated system logs viewer for ssh/local targets. Parses the multi-line
 * `raw` string (journalctl / syslog format) and renders it in a scrollable
 * `<Pre>` with simple level-based colorization. Not used for kubernetes pod
 * logs — those go through `LogStream` via `onStreamLogs`.
 */
export function LogsTab({ raw, target }: { raw: string; target: Target }) {
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
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border.subtle}`, display: "flex", gap: 6, background: C.bg.panel }}>
        {filters.map(f => {
          const active = selected === f.key;
          return (
            <button
              key={f.key}
              onClick={() => load(f.key)}
              style={{
                background: active ? C.bg.active : "transparent",
                border: `1px solid ${active ? C.accent.primary : C.border.subtle}`,
                color: active ? C.accent.light : C.text.muted,
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
          <div style={{ color: C.text.faint, fontSize: 13, textAlign: "center", paddingTop: 40 }}>No logs found</div>
        )}
      </div>
    </div>
  );
}

// ── Generic kubectl table renderer ──────────────────────────────────────────

export type ColorFn = (val: string, col: string) => string | null;

/** Returns true when kubectl output is empty, timed out, errored, or "No resources". */
export function isEmptyKubectl(raw: string | undefined | null): boolean {
  if (!raw) return true;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  return /^\[?(TIMEOUT|ERROR)/i.test(trimmed)
      || /No resources/i.test(trimmed)
      || /not found/i.test(trimmed);
}

/** Inverse of isEmptyKubectl — truthy when there is parseable data. */
export function hasKubectlData(raw: string | undefined | null): boolean {
  return !isEmptyKubectl(raw);
}

// ── Shared ColorFns ─────────────────────────────────────────────────────────

/** Service TYPE column → color (LoadBalancer / NodePort / ClusterIP / ExternalName). */
export const serviceTypeColorFn: ColorFn = (val, col) => {
  if (col.toUpperCase() !== "TYPE") return null;
  if (val === "LoadBalancer") return C.accent.light;
  if (val === "NodePort")     return C.status.info;
  if (val === "ClusterIP")    return C.text.muted;
  if (val === "ExternalName") return C.status.warning;
  return null;
};

/** PVC/PV STATUS column → color (Bound / Pending / Lost). */
export const pvStatusColorFn: ColorFn = (val, col) => {
  if (col.toUpperCase() !== "STATUS") return null;
  if (val === "Bound")   return C.status.success;
  if (val === "Pending") return C.status.warning;
  if (val === "Lost")    return C.status.danger;
  return null;
};

/**
 * Generic renderer for any kubectl column-aligned output. Splits the raw
 * text via `parseKubectl` and builds a semantic `<table role="grid">` with
 * optional per-cell coloring and row click handling.
 *
 * Handles three fallback states before parsing:
 * - Error (TIMEOUT / ERROR / "not found") → amber message
 * - Empty (blank or "No resources found") → gray `emptyMessage`
 * - Unparseable (parse returned no headers) → gray `emptyMessage`
 *
 * @param raw           Output from `kubectl get …` (may be any status).
 * @param colorFn       Optional per-cell colorizer — `(val, col) => string | null`.
 * @param onRowClick    Optional click handler receiving `(cols, headers)`.
 * @param emptyMessage  Copy shown when there is no data (default: "No data").
 */
export function KubectlTable({ raw, colorFn, onRowClick, emptyMessage = "No data" }: {
  raw:        string;
  colorFn?:   ColorFn;
  onRowClick?: (cols: string[], headers: string[]) => void;
  emptyMessage?: string;
}) {
  const trimmed = raw?.trim() ?? "";
  const isError = /^\[?(TIMEOUT|ERROR|not found)/i.test(trimmed);
  const isEmpty = !trimmed || /^\[?No resources/i.test(trimmed);
  if (isError) return <div style={{ padding: "20px 16px", color: C.status.warning, fontSize: 13 }}>{trimmed}</div>;
  if (isEmpty) return <div style={{ padding: "20px 16px", color: C.text.faint, fontSize: 13 }}>{emptyMessage}</div>;

  const { headers, rows } = parseKubectl(raw);
  if (!headers.length) return <div style={{ padding: "20px 16px", color: C.text.faint, fontSize: 13 }}>{emptyMessage}</div>;

  return (
    <table role="grid" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: C.bg.base }}>
          {headers.map(h => (
            <th key={h} scope="col" style={{ padding: "7px 12px", textAlign: "left", fontSize: 11, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".4px", borderBottom: `1px solid ${C.border.muted}`, whiteSpace: "nowrap" }}>{h}</th>
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
            onMouseEnter={ev => { if (onRowClick) ev.currentTarget.style.background = C.bg.card; }}
            onMouseLeave={ev => { ev.currentTarget.style.background = i % 2 === 1 ? "#0c0e16" : "transparent"; }}
          >
            {headers.map((h, j) => {
              const val = cols[j] ?? "—";
              const color = colorFn?.(val, h);
              return (
                <td key={j} style={{ padding: "7px 12px", color: j === 0 ? C.text.primary : C.text.secondary, verticalAlign: "top" }}>
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
