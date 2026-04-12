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
} from "react";
import { createPortal } from "react-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { Target, PodStatus } from "../../types";
import { api, readSSE } from "../../api/client";
import { parseKubectl } from "../../utils/parseKubectl";
import { Sparkles, Play, FileText } from "lucide-react";
import { Pre, LoadingSpinner, PodSummaryBar } from "./primitives";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT, Z_INDEX } from "../../utils/theme";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "../../components/Markdown";
import { EmptyState } from "@/components/ui/empty-state";

// ── Node table ──────────────────────────────────────────────────────────────

const nodeStatusColor = (s: string) => s === "Ready" ? C.status.success : C.status.danger;

/** Parsed node row data fed to the DataTable column definitions. */
interface NodeRowData {
  name: string;
  status: string;
  roles: string;
  age: string;
  version: string;
  internalIp: string;
  statusColor: string;
}

/** Column definitions for the node DataTable. */
function buildNodeColumns(): ColumnDef<NodeRowData, unknown>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="text-[13px] font-semibold">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const { status, statusColor: sc } = row.original;
        return (
          <Badge
            className="text-[11px]"
            style={{ background: sc + "22", color: sc, borderColor: sc + "44" }}
          >
            {status}
          </Badge>
        );
      },
    },
    {
      accessorKey: "roles",
      header: "Roles",
      cell: ({ row }) => (
        <span className="text-xs text-secondary-foreground">{row.original.roles}</span>
      ),
    },
    {
      accessorKey: "age",
      header: "Age",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.age}</span>
      ),
    },
    {
      accessorKey: "version",
      header: "Version",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.version}</span>
      ),
    },
    {
      accessorKey: "internalIp",
      header: "Internal IP",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.internalIp}</span>
      ),
    },
  ];
}

/** Module-level column definitions — stable reference, no closures needed. */
const NODE_COLUMNS = buildNodeColumns();

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

  /** Parse kubectl output lines into typed NodeRowData[]. */
  const parsedRows = useMemo<NodeRowData[]>(() =>
    allLines.slice(1).reduce<NodeRowData[]>((acc, line) => {
      const c = line.trim().split(/\s+/);
      if (c.length < 4) return acc;
      const [name, status, roles, age, version, internalIp] = c;
      acc.push({
        name,
        status,
        roles,
        age,
        version:    version    ?? "—",
        internalIp: internalIp ?? "—",
        statusColor: nodeStatusColor(status),
      });
      return acc;
    }, []),
    [allLines]
  );

  const openNode = useCallback(async (name: string) => {
    setLoading(true);
    try {
      const d = await api.resource(target.id, "node", name, "");
      setResource({ kind: "node", name, ns: "", data: d });
    } finally {
      setLoading(false);
    }
  }, [target.id]);

  const handleRowClick = useCallback((row: NodeRowData) => {
    openNode(row.name);
  }, [openNode]);

  if (!raw || raw.includes("ERROR") || raw.includes("not found")) {
    return <div style={{ padding: SPACE.xl, color: C.text.muted, fontSize: FONT_SIZE.md }}>kubectl not available or no nodes found.</div>;
  }
  if (allLines.length < 2) return <Pre>{raw}</Pre>;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <DataTable<NodeRowData>
        columns={NODE_COLUMNS}
        data={parsedRows}
        onRowClick={handleRowClick}
        emptyMessage="No nodes found"
        keyboardNav
      />

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

// ── PodRowData — typed row shape for DataTable ────────────────────────────

/** Parsed pod row data fed to the DataTable column definitions. */
interface PodRowData {
  ns: string;
  name: string;
  ready: string;
  status: string;
  restarts: string;
  age: string;
  isBad: boolean;
  statusColor: string;
  rawLine: string;
}

/**
 * Builds column definitions for the pod DataTable. Accepts closures over
 * per-row AI badge state and callbacks so cell renderers can access them
 * without prop-drilling through DataTable internals.
 */
function buildPodColumns(opts: {
  aiBadges: Record<string, string>;
  badgeLoading: Record<string, boolean>;
  onDiagnose: (name: string, ns: string, status: string) => void;
  onStreamLogs?: (pod: string, ns: string) => void;
}): ColumnDef<PodRowData, unknown>[] {
  const { aiBadges, badgeLoading, onDiagnose, onStreamLogs } = opts;

  return [
    {
      accessorKey: "ns",
      header: "Namespace",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.ns}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const { name, ns, status, isBad } = row.original;
        const badgeKey = `${ns}/${name}`;
        const aiBadge = aiBadges[badgeKey];
        const isBadgeLoading = !!badgeLoading[badgeKey];

        return (
          <div>
            <span className="text-[13px] font-semibold">{name}</span>
            {isBad && !aiBadge && !isBadgeLoading && (
              <button
                onClick={e => { e.stopPropagation(); onDiagnose(name, ns, status); }}
                aria-label={`Diagnose pod ${name}`}
                title="Get AI diagnosis for this pod"
                style={{
                  marginLeft: SPACE.sm, background: `${C.accent.light}22`, border: `1px solid ${C.accent.light}44`,
                  color: C.accent.light, borderRadius: RADIUS.sm, padding: `${SPACE.xxs}px ${SPACE.sm}px`,
                  fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold, cursor: "pointer", verticalAlign: "middle",
                }}
              >
                <Sparkles size={10} style={{ marginRight: 3, display: "inline" }} /> Diagnose
              </button>
            )}
            {isBadgeLoading && (
              <span style={{ marginLeft: SPACE.sm, fontSize: FONT_SIZE.xs, color: C.accent.light }}>analyzing…</span>
            )}
            {aiBadge && (
              <div style={{
                marginTop: SPACE.xs, fontSize: FONT_SIZE.xs, color: C.accent.light, lineHeight: 1.4,
                background: C.bg.active, border: `1px solid ${C.accent.primary}33`,
                borderRadius: RADIUS.sm, padding: `${SPACE.xs}px ${SPACE.sm}px`, maxWidth: 400,
              }}>
                <Sparkles size={10} style={{ display: "inline", marginRight: 3 }} /> {aiBadge}
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "ready",
      header: "Ready",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.ready}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const { status, statusColor: sc } = row.original;
        return (
          <Badge
            className="text-[11px]"
            style={{ background: sc + "22", color: sc, borderColor: sc + "44" }}
          >
            {status}
          </Badge>
        );
      },
    },
    {
      accessorKey: "restarts",
      header: "Restarts",
      cell: ({ row }) => {
        const r = row.original.restarts;
        const color = +r > 5 ? C.status.warning : +r > 0 ? C.text.secondary : C.text.muted;
        return <span className="text-xs" style={{ color }}>{r}</span>;
      },
    },
    {
      accessorKey: "age",
      header: "Age",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.age}</span>
      ),
    },
    {
      id: "logs",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        if (!onStreamLogs) return null;
        const { name, ns } = row.original;
        return (
          <button
            onClick={e => { e.stopPropagation(); onStreamLogs(name, ns); }}
            aria-label={`Stream live logs for pod ${name}`}
            title="Stream live logs"
            style={{
              background: `${C.status.info}22`, border: `1px solid ${C.status.info}44`,
              color: C.status.info, borderRadius: RADIUS.sm, padding: `${SPACE.xxs}px ${SPACE.sm}px`,
              fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.semibold, cursor: "pointer",
            }}
          >
            <Play size={9} style={{ marginRight: 3, display: "inline" }} /> Logs
          </button>
        );
      },
    },
    {
      id: "chevron",
      header: "",
      enableSorting: false,
      cell: () => (
        <span className="text-muted-foreground text-right block">&#8250;</span>
      ),
    },
  ];
}

/**
 * Pod listing with namespace filter, search, AI badge, and modal.
 *
 * Features:
 * - Summary bar (running/pending/bad) derived from `POD_BAD_STATUSES`
 * - Namespace dropdown (derived from visible rows)
 * - Full-text search across name/ns/status (via DataTable global filter)
 * - Unhealthy rows get a red tint + left accent (via getRowClassName)
 * - Keyboard nav: up/down moves focus, Enter opens the ResourceModal
 * - AI "Diagnose" badge button on bad pods -> calls /analyze for a 1-line
 *   summary, cached per `${ns}/${name}` key
 *
 * @param onStreamLogs Optional callback -- when set, each row shows a "Logs"
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

  /** Parse kubectl output lines into typed PodRowData[], pre-filtered by namespace and search. */
  const parsedRows = useMemo<PodRowData[]>(() =>
    allLines.slice(1).reduce<PodRowData[]>((acc, line) => {
      const c = line.trim().split(/\s+/);
      if (c.length < 5) return acc;
      const [ns, name, ready, status] = c;
      if (nsFilter && ns !== nsFilter) return acc;
      if (deferredSearch && !line.toLowerCase().includes(deferredSearch.toLowerCase())) return acc;
      acc.push({
        ns,
        name,
        ready,
        status,
        restarts: c[4] ?? "0",
        age: c[c.length - 1],
        isBad: POD_BAD_STATUSES.has(status),
        statusColor: podStatusColor(status),
        rawLine: line,
      });
      return acc;
    }, []),
    [allLines, nsFilter, deferredSearch]
  );

  // Note: hooks below are intentionally before the early-return guards so the
  // hook order stays stable.
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
      if (!res.ok) throw new Error(`${res.status}`);
      let text = "";
      for await (const evt of readSSE(res)) {
        if (typeof evt.error === "string") { text = evt.error; break; }
        if (typeof evt.t === "string") text += evt.t;
      }
      setAiBadges(prev => ({ ...prev, [key]: text.slice(0, 120) || "AI unavailable" }));
    } catch {
      setAiBadges(prev => ({ ...prev, [key]: "AI unavailable" }));
    } finally {
      setBadgeLoading(prev => ({ ...prev, [key]: false }));
    }
  }, []);

  const handleRowClick = useCallback((row: PodRowData) => {
    openResource("pod", row.name, row.ns);
  }, [openResource]);

  const getRowClassName = useCallback((row: PodRowData) =>
    row.isBad ? "bg-destructive/5 border-l-2 border-l-destructive" : "",
    []
  );

  /** Column defs are rebuilt when AI badge state changes so cell renderers
   *  close over the latest values. */
  const columns = useMemo(
    () => buildPodColumns({ aiBadges, badgeLoading, onDiagnose: fetchAIBadge, onStreamLogs }),
    [aiBadges, badgeLoading, fetchAIBadge, onStreamLogs]
  );

  if (!raw || raw.includes("ERROR") || raw.includes("not found")) {
    return <div style={{ padding: SPACE.xl, color: C.text.muted, fontSize: FONT_SIZE.md }}>kubectl not available or no pods found.</div>;
  }
  if (allLines.length < 2) return <Pre>{raw}</Pre>;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {podCounts.total > 0 && <PodSummaryBar counts={podCounts} />}

      <DataTable<PodRowData>
        columns={columns}
        data={parsedRows}
        onRowClick={handleRowClick}
        emptyMessage="No pods found"
        keyboardNav
        getRowClassName={getRowClassName}
        toolbar={
          <>
            <select
              value={nsFilter}
              onChange={e => setNsFilter(e.target.value)}
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground"
            >
              <option value="">All namespaces</option>
              {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
            </select>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search pods…"
              className="h-8 flex-1 rounded-md border border-border bg-surface px-3 text-xs text-foreground placeholder:text-muted-foreground"
            />
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {parsedRows.length} pod{parsedRows.length !== 1 ? "s" : ""}
            </span>
          </>
        }
      />

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

export function ResourceModal({ resource, loading, targetId: _targetId, onClose, initialTab = "describe" }: {
  resource: { kind: string; name: string; ns: string; data: Record<string, string> } | null;
  loading:  boolean;
  targetId: string;
  onClose:  () => void;
  /** Tab selected on mount; defaults to describe. */
  initialTab?: "describe" | "logs" | "ai";
}) {
  const [tab, setTab] = useState<"describe" | "logs" | "previous" | "ai">(initialTab);
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
    const prompt = `Analyze this ${resource.kind} "${resource.name}"${resource.ns ? " in namespace " + resource.ns : ""}.\n\nDescribe:\n${(resource.data.describe ?? "").slice(0, 3000)}\n\n${resource.data.logs ? "Recent logs:\n" + resource.data.logs.slice(-1500) : ""}`;
    try {
      const res = await api.analyzeStream(prompt);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      for await (const evt of readSSE(res)) {
        if (typeof evt.error === "string") { setAiText(`Error: ${evt.error}`); return; }
        if (typeof evt.t === "string") setAiText(prev => prev + evt.t);
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (msg.includes("timeout") || msg.includes("Timeout")) {
        setAiText("Analysis timed out. The AI model may be overloaded — try again.");
      } else {
        setAiText(`AI analysis failed: ${msg}`);
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

  // Portal to document.body so the modal escapes any ancestor transform /
  // containing block. Dashboard tabs wrap their content in fadeInStyle which
  // applies `transform: translateY(0)` (with `both` fill mode), which makes
  // `position: fixed` children contain to the tab content box instead of the
  // viewport — causing the modal to render below the top bar and break scroll.
  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)", zIndex: Z_INDEX.modal, display: "flex", alignItems: "center", justifyContent: "center" }}
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
           style={{ background: C.bg.card, border: `1px solid ${C.border.muted}`, borderRadius: RADIUS.xl, width: "min(740px, 92vw)", maxHeight: "82vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,.6), 0 4px 16px rgba(0,0,0,.4)", outline: "none" }}>
        <div style={{ padding: `${SPACE.lg}px ${SPACE.xl}px`, borderBottom: `1px solid ${C.border.muted}`, display: "flex", alignItems: "center", gap: SPACE.md }}>
          <span style={{ background: C.accent.primary + "33", color: C.accent.light, border: `1px solid ${C.accent.primary}`, borderRadius: RADIUS.sm, padding: `${SPACE.xxs}px ${SPACE.sm}px`, fontSize: FONT_SIZE.sm }}>
            {loading ? "…" : resource?.kind}
          </span>
          <strong id="modal-title" style={{ fontSize: FONT_SIZE.lg }}>{resource?.name}</strong>
          {resource?.ns && <span style={{ fontSize: FONT_SIZE.sm, color: C.text.muted }}>· {resource.ns}</span>}
          <span style={{ marginLeft: "auto", fontSize: FONT_SIZE.xs, color: C.text.faint }}>Esc to close</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: C.text.muted, cursor: "pointer", display: "flex", alignItems: "center", padding: SPACE.xs }}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        {!loading && resource && (
          <>
            <div style={{ display: "flex", borderBottom: `1px solid ${C.border.muted}`, padding: `0 ${SPACE.lg}px` }}>
              {modalTabs.map(t => (
                <button key={t} onClick={() => setTab(t as typeof tab)} style={{
                  padding: `${SPACE.sm}px ${SPACE.lg}px`, fontSize: FONT_SIZE.sm, background: "none", border: "none",
                  color: tab === t ? C.accent.light : C.text.muted, borderBottom: tab === t ? `2px solid ${C.accent.light}` : "2px solid transparent",
                  cursor: "pointer", textTransform: "capitalize",
                }}>{t === "previous" ? "Prev Logs" : t === "ai" ? "AI Analysis" : t === "describe" ? "Details" : t}</button>
              ))}
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: SPACE.lg, minHeight: 0 }}>
              {tab === "ai"
                ? (aiLoading ? <LoadingSpinner /> : <Markdown>{aiText}</Markdown>)
                : <Pre>{resource.data[tab === "previous" ? "previous" : tab] ?? "—"}</Pre>
              }
            </div>
          </>
        )}
        {loading && <LoadingSpinner />}
      </div>
    </div>,
    document.body
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
      <div style={{ padding: `${SPACE.sm}px ${SPACE.lg}px`, borderBottom: `1px solid ${C.border.subtle}`, display: "flex", gap: SPACE.sm, background: C.bg.panel }}>
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
                borderRadius: RADIUS.sm, padding: `${SPACE.xs}px ${SPACE.md}px`, fontSize: FONT_SIZE.sm,
                cursor: "pointer", fontWeight: active ? FONT_WEIGHT.semibold : FONT_WEIGHT.normal,
                transition: "all .15s",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: SPACE.lg }}>
        {content ? <Pre>{content}</Pre> : (
          <EmptyState icon={<FileText size={32} />} title="No logs found" description="Select a filter above or check that the target is producing log output." />
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
  if (isError) return <div style={{ padding: `${SPACE.xl}px ${SPACE.lg}px`, color: C.status.warning, fontSize: FONT_SIZE.md }}>{trimmed}</div>;
  if (isEmpty) return <div style={{ padding: `${SPACE.xl}px ${SPACE.lg}px`, color: C.text.faint, fontSize: FONT_SIZE.md }}>{emptyMessage}</div>;

  const { headers, rows } = parseKubectl(raw);
  if (!headers.length) return <div style={{ padding: `${SPACE.xl}px ${SPACE.lg}px`, color: C.text.faint, fontSize: FONT_SIZE.md }}>{emptyMessage}</div>;

  return (
    <table role="grid" style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT_SIZE.sm }}>
      <thead>
        <tr style={{ background: C.bg.base }}>
          {headers.map(h => (
            <th key={h} scope="col" style={{ padding: `${SPACE.sm}px ${SPACE.md}px`, textAlign: "left", fontSize: FONT_SIZE.sm, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".4px", borderBottom: `1px solid ${C.border.muted}`, whiteSpace: "nowrap" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cols, i) => (
          <tr key={i}
            tabIndex={onRowClick ? 0 : undefined}
            className={onRowClick ? "hover-bg-raised" : undefined}
            onClick={() => onRowClick?.(cols, headers)}
            onKeyDown={e => { if (onRowClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRowClick(cols, headers); } }}
            style={{ cursor: onRowClick ? "pointer" : "default", background: i % 2 === 1 ? "var(--c-bg-surface)" : "transparent", transition: "background .1s" }}
          >
            {headers.map((h, j) => {
              const val = cols[j] ?? "—";
              const color = colorFn?.(val, h);
              return (
                <td key={j} style={{ padding: `${SPACE.sm}px ${SPACE.md}px`, color: j === 0 ? C.text.primary : C.text.secondary, verticalAlign: "top" }}>
                  {color
                    ? <span style={{ background: color + "22", color, border: `1px solid ${color}44`, borderRadius: RADIUS.sm, padding: `${SPACE.xxs}px ${SPACE.sm}px`, fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold }}>{val}</span>
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
