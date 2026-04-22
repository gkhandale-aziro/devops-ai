import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { X, Sparkles, ArrowRight, ChevronDown, ChevronRight, Clock, Server, Layers, Play } from "lucide-react";
import { Breadcrumb } from "../components/ui/breadcrumb";
import type { ColumnDef } from "@tanstack/react-table";
import type { StoredEvent, TriageLevel, Snapshot, Analysis, IncidentStatus } from "../types";
import { LEVEL_COLORS, LEVEL_LABELS } from "../types";
import { api } from "../api/client";
import { LevelBadge }   from "../components/LevelBadge";
import { AIDrawer }      from "../components/AIDrawer";
import { ExecuteAndVerifyModal } from "../components/ExecuteAndVerifyModal";
import { useAuth } from "../auth/AuthContext";
import { skeletonStyle } from "../utils/animations";
import { FONT_SIZE, FONT_WEIGHT, RADIUS, SPACE } from "../utils/theme";
import { DataTable }     from "@/components/ui/data-table";
import { Badge }         from "@/components/ui/badge";
import { EmptyState }    from "@/components/ui/empty-state";

const LEVELS: TriageLevel[] = ["SEV1", "SEV2", "SEV3"];

const STATUS_STYLES: Record<IncidentStatus, { color: string; bg: string; label: string }> = {
  open:         { color: "var(--c-sev1)",  bg: "var(--c-sev1-bg)",  label: "Open"         },
  acknowledged: { color: "var(--c-sev2)",  bg: "var(--c-sev2-bg)",  label: "Acknowledged" },
  resolved:     { color: "var(--c-green)", bg: "var(--c-green-bg)", label: "Resolved"     },
};

type ViewMode = "flat" | "grouped";

/**
 * Builds column definitions for the incident history DataTable.
 * Accepts closures so cell renderers can access per-render state without
 * prop-drilling through DataTable internals (same pattern as PodTable).
 */
function buildIncidentColumns(opts: {
  openAIForEvent: (ev: StoredEvent) => void;
  showTarget: boolean;
}): ColumnDef<StoredEvent, unknown>[] {
  const { openAIForEvent, showTarget } = opts;
  const cols: ColumnDef<StoredEvent, unknown>[] = [
    {
      accessorKey: "level",
      header: "Severity",
      cell: ({ row }) => <LevelBadge level={row.original.level} />,
    },
    {
      accessorKey: "timestamp",
      header: "Time",
      cell: ({ row }) => (
        <span
          title={row.original.timestamp}
          className="text-xs text-muted-foreground whitespace-nowrap"
        >
          {relativeTime(row.original.timestamp)}
        </span>
      ),
    },
  ];

  // Target column — only when events have target info
  if (showTarget) {
    cols.push({
      accessorKey: "target_name",
      header: "Target",
      cell: ({ row }) => {
        const e = row.original;
        if (!e.target_name) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Server size={12} style={{ color: "var(--c-accent)", flexShrink: 0 }} />
            <span style={{ fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.medium }}>{e.target_name}</span>
          </div>
        );
      },
    });
  }

  cols.push(
    {
      accessorKey: "reason",
      header: "Reason",
      cell: ({ row }) => {
        const e = row.original;
        return (
          <div>
            <div style={{ fontSize: FONT_SIZE.md, fontWeight: FONT_WEIGHT.medium }}>{e.reason}</div>
            {e.last_diagnosis && (
              <div style={{ fontSize: FONT_SIZE.xs, color: "var(--c-text-muted)", marginTop: SPACE.xxs, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                <Sparkles size={9} style={{ display: "inline", marginRight: 3 }} />
                {e.last_diagnosis.slice(0, 80)}{e.last_diagnosis.length > 80 ? "…" : ""}
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "object",
      header: "Object / Source",
      cell: ({ row }) => {
        const e = row.original;
        return (
          <div style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <div style={{ fontSize: FONT_SIZE.md, fontWeight: FONT_WEIGHT.medium }}>{e.object}</div>
            <div style={{ fontSize: FONT_SIZE.xs, color: "var(--c-text-muted)" }}>
              {e.source}{e.namespace ? ` / ${e.namespace}` : ""}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const ss = STATUS_STYLES[row.original.status ?? "open"];
        return (
          <Badge
            className="text-[10px] font-semibold"
            style={{ color: ss.color, background: ss.bg, borderColor: ss.color + "44" }}
          >
            {ss.label}
          </Badge>
        );
      },
    },
    {
      id: "ai_action",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <button
          onClick={(ev) => { ev.stopPropagation(); openAIForEvent(row.original); }}
          title="Ask AI about this incident"
          style={{
            background: "var(--c-accent-dim)",
            border: "1px solid var(--c-border)",
            color: "var(--c-accent-hover)",
            borderRadius: RADIUS.md,
            padding: "4px 10px",
            fontSize: FONT_SIZE.sm,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <Sparkles size={10} style={{ marginRight: 3, display: "inline" }} /> AI
        </button>
      ),
    },
  );

  return cols;
}

/** Extract workload name from object: pod/nginx-abc123 → nginx, pod/web-server-xyz → web-server */
function workloadName(object: string): string {
  // Remove resource prefix (pod/, node/, etc.)
  const name = object.includes("/") ? object.split("/").pop()! : object;
  // Strip trailing pod hash: name-<replicaset-hash>-<pod-hash>
  // Common pattern: deployment-name-7f8b9c6d4-x2k9l → deployment-name
  const match = name.match(/^(.+?)-[a-z0-9]{6,10}-[a-z0-9]{4,5}$/);
  if (match) return match[1];
  // ReplicaSet pattern: name-7f8b9c6d4 → name
  const rsMatch = name.match(/^(.+?)-[a-f0-9]{6,10}$/);
  if (rsMatch) return rsMatch[1];
  return name;
}

interface WorkloadGroup {
  workload: string;
  namespace: string;
  targetName: string;
  events: StoredEvent[];
  worstLevel: TriageLevel;
  latestTime: string;
  openCount: number;
}

function relativeTime(ts: string): string {
  const ms = new Date(ts).getTime();
  if (isNaN(ms)) return ts;
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 0)    return "just now";
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const SEV_ORDER: Record<string, number> = { SEV1: 0, SEV2: 1, SEV3: 2 };

export function History() {
  const [events,        setEvents]        = useState<StoredEvent[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [loadError,     setLoadError]     = useState("");
  const [level,         setLevel]         = useState<TriageLevel | "">("");
  const [nsFilter,      setNsFilter]      = useState("");
  const [objFilter,     setObjFilter]     = useState("");
  const [objInput,      setObjInput]      = useState("");
  const [selectedId,    setSelectedId]    = useState<number | null>(null);
  const [detail,        setDetail]        = useState<StoredEvent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [viewMode,      setViewMode]      = useState<ViewMode>("grouped");

  // AI drawer state
  const [aiDrawerOpen, setAiDrawerOpen]   = useState(false);
  const [aiContext,    setAiContext]       = useState("");
  const [aiTitle,      setAiTitle]        = useState("");

  // Execute & Verify modal — admin-only, gated on analysis.remediation
  const { canWrite } = useAuth();
  const [executeOpen,    setExecuteOpen]    = useState(false);
  const [executeCommand, setExecuteCommand] = useState("");

  // Expanded workload groups
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleObjInput(val: string) {
    setObjInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setObjFilter(val), 300);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [level, objFilter]);

  async function load() {
    setLoadError("");
    try {
      const params: { level?: TriageLevel; object?: string; limit?: number } = { limit: 100 };
      if (level)     params.level  = level;
      if (objFilter) params.object = objFilter;
      setEvents(await api.events.list(params));
    } catch {
      setLoadError("Failed to load events — is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(id: number) {
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const ev = await api.events.get(id);
      setDetail(ev);
    } finally {
      setDetailLoading(false);
    }
  }

  const openAIForEvent = useCallback((ev: StoredEvent) => {
    const snaps = (ev.snapshots ?? [])
      .map(s => `\n── ${s.kind} ──\n${s.content?.slice(0, 1500)}`)
      .join("\n");
    const prompt =
      `You are a Kubernetes SRE. Explain this incident clearly and suggest remediation steps.\n\n` +
      (ev.target_name ? `Target: ${ev.target_name}\n` : "") +
      `Severity: ${ev.level} (${(LEVEL_LABELS as Record<string, string>)[ev.level] ?? ev.level})\n` +
      `Reason: ${ev.reason}\nObject: ${ev.object}${ev.namespace ? " / " + ev.namespace : ""}\n` +
      `Source: ${ev.source}\nTime: ${ev.timestamp}\nMessage: ${ev.message ?? "—"}\n${snaps}`;
    setAiContext(prompt);
    setAiTitle(`AI: ${ev.reason} — ${ev.object}`);
    setAiDrawerOpen(true);
  }, []);

  // Check if any events have target info
  const hasTargetInfo = useMemo(() => events.some(e => !!e.target_name), [events]);

  /** Column defs — rebuilt when target info availability changes. */
  const incidentColumns = useMemo(
    () => buildIncidentColumns({ openAIForEvent, showTarget: hasTargetInfo }),
    [openAIForEvent, hasTargetInfo]
  );

  /** Highlight selected row. */
  const getRowClassName = useCallback((e: StoredEvent): string => {
    const parts: string[] = [];
    if (e.id === selectedId) parts.push("bg-[var(--c-bg-active)]");
    return parts.join(" ");
  }, [selectedId]);

  async function updateStatus(ev: StoredEvent, status: IncidentStatus) {
    await api.events.updateStatus(ev.id, status);
    setDetail((d: StoredEvent | null) => d ? { ...d, status } : d);
    setEvents((prev: StoredEvent[]) => prev.map((e: StoredEvent) => e.id === ev.id ? { ...e, status } : e));
  }

  const namespaces = useMemo(() => {
    const s = new Set(events.map(e => e.namespace).filter(Boolean));
    return Array.from(s).sort();
  }, [events]);

  const filtered = useMemo(() => {
    return nsFilter ? events.filter(e => e.namespace === nsFilter) : events;
  }, [events, nsFilter]);

  /** Group events by workload (deployment/pod base name). */
  const workloadGroups = useMemo((): WorkloadGroup[] => {
    const groups: Record<string, WorkloadGroup> = {};
    for (const e of filtered) {
      const wl = workloadName(e.object);
      const key = `${e.target_name || "unknown"}|${e.namespace || "default"}|${wl}`;
      if (!groups[key]) {
        groups[key] = {
          workload: wl,
          namespace: e.namespace || "default",
          targetName: e.target_name || "",
          events: [],
          worstLevel: "SEV3",
          latestTime: e.timestamp,
          openCount: 0,
        };
      }
      const g = groups[key];
      g.events.push(e);
      if (SEV_ORDER[e.level] < SEV_ORDER[g.worstLevel]) g.worstLevel = e.level as TriageLevel;
      if (e.timestamp > g.latestTime) g.latestTime = e.timestamp;
      if ((e.status ?? "open") === "open") g.openCount++;
    }
    // Sort: worst severity first, then most recent
    return Object.values(groups).sort((a, b) => {
      const sevDiff = SEV_ORDER[a.worstLevel] - SEV_ORDER[b.worstLevel];
      if (sevDiff !== 0) return sevDiff;
      return b.latestTime.localeCompare(a.latestTime);
    });
  }, [filtered]);

  function toggleGroup(key: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const hasFilters = level !== "" || objInput !== "" || nsFilter !== "";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", margin: -1 }}>Incident History</h1>

      {/* ── Page header + filters (top bar) ─────────────────────────────── */}
      <div style={{
        padding: "12px 20px",
        borderBottom: "1px solid var(--c-border)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexShrink: 0,
        background: "var(--c-bg-raised)",
        flexWrap: "wrap",
      }}>
        <Breadcrumb items={[
          { label: "Home", href: "/" },
          { label: "Incident History", icon: <Clock size={14} /> },
        ]} />

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* View mode toggle */}
          <div style={{ display: "flex", borderRadius: RADIUS.md, overflow: "hidden", border: "1px solid var(--c-border-strong)" }}>
            <button
              onClick={() => setViewMode("grouped")}
              title="Group by workload"
              style={{
                padding: "4px 10px", fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold, cursor: "pointer",
                background: viewMode === "grouped" ? "var(--c-bg-active)" : "var(--c-bg-surface)",
                border: "none",
                color: viewMode === "grouped" ? "var(--c-accent-hover)" : "var(--c-text-muted)",
                display: "flex", alignItems: "center", gap: 4,
              }}
            ><Layers size={12} /> Grouped</button>
            <button
              onClick={() => setViewMode("flat")}
              title="Flat list"
              style={{
                padding: "4px 10px", fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold, cursor: "pointer",
                background: viewMode === "flat" ? "var(--c-bg-active)" : "var(--c-bg-surface)",
                border: "none", borderLeft: "1px solid var(--c-border-strong)",
                color: viewMode === "flat" ? "var(--c-accent-hover)" : "var(--c-text-muted)",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >Flat</button>
          </div>

          <div style={{ width: 1, height: 20, background: "var(--c-border-strong)", flexShrink: 0 }} />

          {/* Severity filter pills */}
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setLevel("")}
              style={{
                padding: "4px 10px", borderRadius: RADIUS.xl, fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold, cursor: "pointer",
                background: level === "" ? "var(--c-bg-active)" : "transparent",
                border: `1px solid ${level === "" ? "var(--c-accent-hover)" : "var(--c-border-strong)"}`,
                color: level === "" ? "var(--c-accent-hover)" : "var(--c-text-muted)",
              }}
            >All</button>
            {LEVELS.map(l => {
              const c = LEVEL_COLORS[l];
              return (
                <button key={l} onClick={() => setLevel(l)} style={{
                  padding: "4px 10px", borderRadius: RADIUS.xl, fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold, cursor: "pointer",
                  background: level === l ? c.bg : "transparent",
                  border: `1px solid ${level === l ? c.border : "var(--c-border-strong)"}`,
                  color: level === l ? c.text : "var(--c-text-muted)",
                }}>{l}</button>
              );
            })}
          </div>

          {/* Namespace filter */}
          <select
            value={nsFilter}
            onChange={e => setNsFilter(e.target.value)}
            aria-label="Filter by namespace"
            style={{
              background: "var(--c-bg-surface)",
              border: `1px solid ${nsFilter ? "var(--c-accent-hover)" : "var(--c-border-strong)"}`,
              color: nsFilter ? "var(--c-accent-hover)" : "var(--c-text-muted)",
              borderRadius: RADIUS.md,
              padding: "5px 8px",
              fontSize: FONT_SIZE.sm,
              fontWeight: FONT_WEIGHT.semibold,
              outline: "none",
              cursor: "pointer",
            }}
          >
            <option value="">All Namespaces</option>
            {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
          </select>

          {/* Object search */}
          <div style={{ position: "relative" }}>
            <input
              value={objInput}
              onChange={e => handleObjInput(e.target.value)}
              placeholder="Search object…"
              style={{
                background: "var(--c-bg-surface)",
                border: "1px solid var(--c-border-strong)",
                color: "var(--c-text-primary)",
                borderRadius: RADIUS.md,
                padding: "5px 10px 5px 30px",
                fontSize: FONT_SIZE.sm,
                outline: "none",
                width: 180,
              }}
            />
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--c-text-muted)" strokeWidth="2"
              style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)" }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>

          {hasFilters && (
            <button
              onClick={() => { setLevel(""); setObjInput(""); setObjFilter(""); setNsFilter(""); }}
              style={{ background: "none", border: "none", color: "var(--c-text-muted)", fontSize: FONT_SIZE.sm, cursor: "pointer", padding: "2px 6px" }}
            >Clear</button>
          )}

          <div style={{ width: 1, height: 20, background: "var(--c-border-strong)", flexShrink: 0 }} />
          <span style={{ fontSize: FONT_SIZE.sm, color: "var(--c-text-muted)" }}>
            {loading ? "Loading…" : viewMode === "grouped"
              ? `${workloadGroups.length} workload${workloadGroups.length !== 1 ? "s" : ""} · ${filtered.length} event${filtered.length !== 1 ? "s" : ""}`
              : `${filtered.length} event${filtered.length !== 1 ? "s" : ""}`
            }
          </span>
          <button
            onClick={load}
            title="Refresh"
            style={{ background: "none", border: "none", color: "var(--c-text-muted)", cursor: "pointer", padding: "2px 4px", display: "flex", alignItems: "center" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Main content area ──────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Event table / grouped view */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loadError && (
              <div style={{ margin: SPACE.lg, padding: "10px 14px", background: "var(--c-sev1-bg)", border: "1px solid var(--c-sev1)", borderRadius: RADIUS.lg, fontSize: FONT_SIZE.sm, color: "var(--c-sev1)" }}>
                {loadError}
              </div>
            )}

            {loading && !loadError && (
              <div style={{ padding: "8px 0" }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, padding: "10px 20px", borderBottom: "1px solid var(--c-border)" }}>
                    <div style={{ width: 60, height: 18, background: "var(--c-bg-card)", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
                    <div style={{ width: 80, height: 18, background: "var(--c-bg-card)", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
                    <div style={{ flex: 1, height: 18, background: "var(--c-bg-card)", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
                  </div>
                ))}
              </div>
            )}

            {!loading && !loadError && filtered.length === 0 && (
              <EmptyState
                icon={<Clock size={32} />}
                title="No incidents recorded yet"
                description="Start monitoring a target to capture events."
              />
            )}

            {/* ── Grouped view ── */}
            {filtered.length > 0 && viewMode === "grouped" && (
              <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: SPACE.sm }}>
                {workloadGroups.map(g => {
                  const groupKey = `${g.targetName}|${g.namespace}|${g.workload}`;
                  const isExpanded = expandedGroups.has(groupKey);
                  const levelColor = LEVEL_COLORS[g.worstLevel];

                  return (
                    <div key={groupKey} style={{
                      border: `1px solid ${levelColor.border}`,
                      borderRadius: RADIUS.lg,
                      overflow: "hidden",
                      background: "var(--c-bg-surface)",
                    }}>
                      {/* Group header */}
                      <button
                        onClick={() => toggleGroup(groupKey)}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", gap: SPACE.sm,
                          padding: `${SPACE.sm}px ${SPACE.md}px`,
                          background: levelColor.bg,
                          border: "none",
                          borderBottom: isExpanded ? `1px solid ${levelColor.border}` : "none",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span style={{ color: levelColor.text, display: "flex", alignItems: "center" }}>
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </span>

                        <LevelBadge level={g.worstLevel} />

                        <span style={{ fontWeight: FONT_WEIGHT.semibold, fontSize: FONT_SIZE.md, color: "var(--c-text-primary)" }}>
                          {g.workload}
                        </span>

                        <span style={{ fontSize: FONT_SIZE.xs, color: "var(--c-text-muted)" }}>
                          {g.namespace}
                        </span>

                        {g.targetName && (
                          <span style={{
                            display: "flex", alignItems: "center", gap: 4,
                            fontSize: FONT_SIZE.xs, color: "var(--c-accent-hover)",
                            background: "var(--c-accent-dim)",
                            padding: `2px ${SPACE.sm}px`,
                            borderRadius: RADIUS.md,
                          }}>
                            <Server size={10} />
                            {g.targetName}
                          </span>
                        )}

                        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: SPACE.sm }}>
                          {g.openCount > 0 && (
                            <span style={{
                              fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.bold,
                              color: levelColor.text,
                              background: levelColor.bg,
                              border: `1px solid ${levelColor.border}`,
                              padding: `2px ${SPACE.sm}px`,
                              borderRadius: RADIUS.md,
                            }}>
                              {g.openCount} open
                            </span>
                          )}
                          <span style={{ fontSize: FONT_SIZE.xs, color: "var(--c-text-muted)" }}>
                            {g.events.length} event{g.events.length !== 1 ? "s" : ""}
                          </span>
                          <span style={{ fontSize: FONT_SIZE.xs, color: "var(--c-text-muted)" }}>
                            {relativeTime(g.latestTime)}
                          </span>
                        </div>
                      </button>

                      {/* Expanded: show events in this group */}
                      {isExpanded && (
                        <div>
                          <DataTable<StoredEvent>
                            columns={incidentColumns}
                            data={g.events}
                            onRowClick={(e) => openDetail(e.id)}
                            getRowClassName={getRowClassName}
                            emptyMessage="No events"
                            keyboardNav
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Flat view ── */}
            {filtered.length > 0 && viewMode === "flat" && (
              <DataTable<StoredEvent>
                columns={incidentColumns}
                data={filtered}
                onRowClick={(e) => openDetail(e.id)}
                getRowClassName={getRowClassName}
                emptyMessage="No incidents recorded yet."
                keyboardNav
              />
            )}
          </div>
        </div>

        {/* ── Detail panel ────────────────────────────────────────────── */}
        {(detail || detailLoading) && (
          <div style={{
            width: 420,
            background: "var(--c-bg-panel)",
            borderLeft: "1px solid var(--c-border-strong)",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            animation: "slideInRight .2s ease-out",
          }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--c-border-strong)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {detail && <LevelBadge level={detail.level} showLabel />}
              <strong style={{ fontSize: FONT_SIZE.md, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {detail?.reason ?? "Loading…"}
              </strong>
              <button onClick={() => { setDetail(null); setSelectedId(null); }}
                style={{ background: "none", border: "none", color: "var(--c-text-muted)", cursor: "pointer", display: "flex", alignItems: "center" }}><X size={16} /></button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {detailLoading && <Skeleton />}

              {detail && (
                <>
                  {/* meta grid */}
                  <div style={{ background: "var(--c-bg-raised)", border: "1px solid var(--c-border-strong)", borderRadius: RADIUS.lg, padding: SPACE.md, marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACE.sm, fontSize: FONT_SIZE.sm }}>
                    <MetaRow label="Object"    value={detail.object} />
                    <MetaRow label="Namespace" value={detail.namespace || "—"} />
                    <MetaRow label="Source"    value={detail.source} />
                    <MetaRow label="Time"      value={relativeTime(detail.timestamp)} title={detail.timestamp} />
                    {detail.target_name && (
                      <MetaRow label="Target" value={detail.target_name} />
                    )}
                  </div>

                  {/* status buttons */}
                  <div style={{ marginBottom: 14 }}>
                    <FieldLabel>Status</FieldLabel>
                    <div style={{ display: "flex", gap: 6 }}>
                      {(["open", "acknowledged", "resolved"] as IncidentStatus[]).map(s => {
                        const ss = STATUS_STYLES[s];
                        const active = (detail.status ?? "open") === s;
                        return (
                          <button
                            key={s}
                            onClick={() => updateStatus(detail, s)}
                            style={{
                              flex: 1, padding: "6px 8px", fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold, borderRadius: RADIUS.md, cursor: "pointer",
                              background: active ? ss.bg : "var(--c-bg-raised)",
                              border: `1px solid ${active ? ss.color : "var(--c-border-strong)"}`,
                              color: active ? ss.color : "var(--c-text-muted)",
                              transition: "all .15s",
                            }}
                          >{ss.label}</button>
                        );
                      })}
                    </div>
                  </div>

                  {detail.message && (
                    <Section label="Event Message">
                      <div style={{ fontSize: FONT_SIZE.sm, color: "var(--c-text-secondary)", lineHeight: 1.6 }}>{detail.message}</div>
                    </Section>
                  )}

                  {/* AI explain button */}
                  <button
                    onClick={() => openAIForEvent(detail)}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      background: "var(--c-accent-dim)",
                      border: "1px solid var(--c-border)",
                      color: "var(--c-accent-hover)",
                      borderRadius: RADIUS.lg,
                      fontSize: FONT_SIZE.md,
                      fontWeight: FONT_WEIGHT.semibold,
                      cursor: "pointer",
                      marginBottom: 14,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <Sparkles size={14} /> Ask AI to Explain
                  </button>

                  {/* snapshots — describe/logs from triage, execution/verification from Execute flow */}
                  {(["describe", "logs", "logs_previous", "events", "execution", "verification"] as Snapshot["kind"][]).map(kind => {
                    const snap = detail.snapshots?.find(s => s.kind === kind);
                    if (!snap) return null;
                    const labels: Record<string, string> = {
                      describe: "kubectl describe", logs: "kubectl logs",
                      logs_previous: "kubectl logs --previous", events: "Cluster events",
                      execution: "Execution (kubectl run)", verification: "Verification (health probe)",
                    };
                    return (
                      <CollapsibleSection key={kind} label={labels[kind]}>
                        <pre style={{ background: "var(--c-bg-overlay)", color: "var(--c-text-secondary)", borderRadius: RADIUS.md, padding: 10, fontSize: FONT_SIZE.sm, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto", margin: 0 }}>
                          {snap.content}
                        </pre>
                      </CollapsibleSection>
                    );
                  })}

                  {(detail.analyses ?? []).slice(-1).map((a: Analysis) => a.remediation ? (
                    <Section key={a.id} label="Proposed Remediation">
                      <div style={{ background: "var(--c-bg-raised)", border: "1px solid var(--c-sev2-bg)", borderRadius: RADIUS.md, padding: SPACE.md, fontSize: FONT_SIZE.sm, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--c-sev2)" }}>
                        {a.remediation}
                      </div>
                      {canWrite && extractKubectl(a.remediation) && detail.status !== "resolved" && (
                        <button
                          onClick={() => {
                            setExecuteCommand(extractKubectl(a.remediation) ?? "");
                            setExecuteOpen(true);
                          }}
                          style={{
                            marginTop: 10, width: "100%", padding: "10px 14px",
                            background: "var(--c-accent)", border: "none",
                            color: "var(--c-accent-fg, #fff)",
                            borderRadius: RADIUS.lg, fontSize: FONT_SIZE.md,
                            fontWeight: FONT_WEIGHT.semibold, cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                          }}
                        >
                          <Play size={14} /> Execute &amp; Verify
                        </button>
                      )}
                    </Section>
                  ) : null)}

                  <div style={{ display: "flex", gap: 10, marginTop: 8, paddingTop: 12, borderTop: "1px solid var(--c-border-strong)" }}>
                    <button
                      onClick={() => { setObjInput(detail.object); setObjFilter(detail.object); setDetail(null); setSelectedId(null); }}
                      style={{ background: "none", border: "none", color: "var(--c-accent-hover)", fontSize: FONT_SIZE.sm, cursor: "pointer", padding: 0 }}
                    >
                      View all for {detail.object} <ArrowRight size={11} style={{ marginLeft: 3 }} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* AI Drawer */}
      <AIDrawer open={aiDrawerOpen} context={aiContext} title={aiTitle} onClose={() => setAiDrawerOpen(false)} />

      {/* Execute & Verify — refetch detail on completion so the execution /
          verification snapshots render in the drawer alongside describe/logs. */}
      {detail && (
        <ExecuteAndVerifyModal
          open={executeOpen}
          mode={{ kind: "event", event: detail }}
          initialCommand={executeCommand}
          onClose={() => setExecuteOpen(false)}
          onCompleted={() => { openDetail(detail.id); }}
        />
      )}

    </div>
  );
}

/**
 * Extract the first `kubectl …` command from a free-text remediation string.
 * Mirrors monitor/verify.py's parse_proposed_command — the backend validates
 * again, this is only for pre-filling the modal so the operator doesn't have
 * to type the command themselves.
 */
function extractKubectl(remediation: string): string | null {
  if (!remediation) return null;
  for (const raw of remediation.split("\n")) {
    let line = raw.trim().replace(/^`+/, "").replace(/`+$/, "").trim();
    for (const prefix of ["$ ", "# ", "> "]) {
      if (line.startsWith(prefix)) line = line.slice(prefix.length);
    }
    if (line.startsWith("kubectl ")) return line;
  }
  return null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.bold, textTransform: "uppercase", letterSpacing: ".8px", color: "var(--c-text-muted)", marginBottom: SPACE.xs }}>{children}</div>;
}

function MetaRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div>
      <div style={{ fontSize: FONT_SIZE.xs, color: "var(--c-text-muted)", textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</div>
      <div style={{ fontSize: FONT_SIZE.sm, color: "var(--c-text-primary)", marginTop: SPACE.xxs, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={title}>{value}</div>
    </div>
  );
}

function Section({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: FONT_SIZE.sm, textTransform: "uppercase", color: "var(--c-text-muted)", letterSpacing: ".5px", marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

function CollapsibleSection({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 10 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "5px 0", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
      >
        <span style={{ color: "var(--c-text-muted)", display: "flex", alignItems: "center" }}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
        <span style={{ fontSize: FONT_SIZE.sm, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--c-text-muted)" }}>{label}</span>
      </button>
      {open && children}
    </div>
  );
}

function Skeleton() {
  return (
    <div>
      {[120, 80, 200, 160].map((w, i) => (
        <div key={i} style={{ height: 14, width: w, marginBottom: 12, ...skeletonStyle }} />
      ))}
    </div>
  );
}
