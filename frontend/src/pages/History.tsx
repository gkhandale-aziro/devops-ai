import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { X, Sparkles, ArrowRight, ChevronDown, ChevronRight, Clock } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { StoredEvent, TriageLevel, Snapshot, Analysis, IncidentStatus } from "../types";
import { LEVEL_COLORS, LEVEL_LABELS } from "../types";
import { api } from "../api/client";
import { LevelBadge }   from "../components/LevelBadge";
import { AIDrawer }      from "../components/AIDrawer";
import { skeletonStyle } from "../utils/animations";
import { DataTable }     from "@/components/ui/data-table";
import { Badge }         from "@/components/ui/badge";
import { EmptyState }    from "@/components/ui/empty-state";

const LEVELS: TriageLevel[] = ["SEV1", "SEV2", "SEV3"];

const STATUS_STYLES: Record<IncidentStatus, { color: string; bg: string; label: string }> = {
  open:         { color: "var(--c-sev1)",  bg: "var(--c-sev1-bg)",  label: "Open"         },
  acknowledged: { color: "var(--c-sev2)",  bg: "var(--c-sev2-bg)",  label: "Acknowledged" },
  resolved:     { color: "var(--c-green)", bg: "var(--c-green-bg)", label: "Resolved"     },
};

/**
 * Builds column definitions for the incident history DataTable.
 * Accepts closures so cell renderers can access per-render state without
 * prop-drilling through DataTable internals (same pattern as PodTable).
 */
function buildIncidentColumns(opts: {
  openAIForEvent: (ev: StoredEvent) => void;
}): ColumnDef<StoredEvent, unknown>[] {
  const { openAIForEvent } = opts;
  return [
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
    {
      accessorKey: "reason",
      header: "Reason",
      cell: ({ row }) => {
        const e = row.original;
        return (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{e.reason}</div>
            {e.last_diagnosis && (
              <div style={{ fontSize: 10, color: "var(--c-text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
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
            <div style={{ fontSize: 13, fontWeight: 500 }}>{e.object}</div>
            <div style={{ fontSize: 10, color: "var(--c-text-muted)" }}>
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
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 11,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <Sparkles size={10} style={{ marginRight: 3, display: "inline" }} /> AI
        </button>
      ),
    },
  ];
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

  // AI drawer state
  const [aiDrawerOpen, setAiDrawerOpen]   = useState(false);
  const [aiContext,    setAiContext]       = useState("");
  const [aiTitle,      setAiTitle]        = useState("");

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
      `Severity: ${ev.level} (${(LEVEL_LABELS as Record<string, string>)[ev.level] ?? ev.level})\n` +
      `Reason: ${ev.reason}\nObject: ${ev.object}${ev.namespace ? " / " + ev.namespace : ""}\n` +
      `Source: ${ev.source}\nTime: ${ev.timestamp}\nMessage: ${ev.message ?? "—"}\n${snaps}`;
    setAiContext(prompt);
    setAiTitle(`AI: ${ev.reason} — ${ev.object}`);
    setAiDrawerOpen(true);
  }, []);

  /** Column defs are rebuilt only when openAIForEvent changes (stable ref). */
  const incidentColumns = useMemo(
    () => buildIncidentColumns({ openAIForEvent }),
    [openAIForEvent]
  );

  /** Highlight selected row + add severity left-border accent via CSS classes. */
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
    if (!nsFilter) return events;
    return events.filter(e => e.namespace === nsFilter);
  }, [events, nsFilter]);

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
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent-hover)" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <strong style={{ fontSize: 15 }}>Incident History</strong>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {/* Severity filter pills */}
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setLevel("")}
              style={{
                padding: "4px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: level === "" ? "var(--c-bg-active)" : "transparent",
                border: `1px solid ${level === "" ? "var(--c-accent-hover)" : "var(--c-border-strong)"}`,
                color: level === "" ? "var(--c-accent-hover)" : "var(--c-text-muted)",
              }}
            >All</button>
            {LEVELS.map(l => {
              const c = LEVEL_COLORS[l];
              return (
                <button key={l} onClick={() => setLevel(l)} style={{
                  padding: "4px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: "pointer",
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
              borderRadius: 6,
              padding: "5px 8px",
              fontSize: 11,
              fontWeight: 600,
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
                borderRadius: 6,
                padding: "5px 10px 5px 30px",
                fontSize: 12,
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
              style={{ background: "none", border: "none", color: "var(--c-text-muted)", fontSize: 11, cursor: "pointer", padding: "2px 6px" }}
            >Clear</button>
          )}

          <div style={{ width: 1, height: 20, background: "var(--c-border-strong)", flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: "var(--c-text-muted)" }}>
            {loading ? "Loading…" : `${filtered.length} event${filtered.length !== 1 ? "s" : ""}`}
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

        {/* Event table — full width */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loadError && (
              <div style={{ margin: 16, padding: "10px 14px", background: "var(--c-sev1-bg)", border: "1px solid var(--c-sev1)", borderRadius: 8, fontSize: 12, color: "var(--c-sev1)" }}>
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

            {filtered.length > 0 && (
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
              <strong style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                  <div style={{ background: "var(--c-bg-raised)", border: "1px solid var(--c-border-strong)", borderRadius: 8, padding: 12, marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                    <MetaRow label="Object"    value={detail.object} />
                    <MetaRow label="Namespace" value={detail.namespace || "—"} />
                    <MetaRow label="Source"    value={detail.source} />
                    <MetaRow label="Time"      value={relativeTime(detail.timestamp)} title={detail.timestamp} />
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
                              flex: 1, padding: "6px 8px", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer",
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
                      <div style={{ fontSize: 12, color: "var(--c-text-secondary)", lineHeight: 1.6 }}>{detail.message}</div>
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
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
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

                  {/* snapshots */}
                  {(["describe", "logs", "logs_previous", "events"] as Snapshot["kind"][]).map(kind => {
                    const snap = detail.snapshots?.find(s => s.kind === kind);
                    if (!snap) return null;
                    const labels: Record<string, string> = {
                      describe: "kubectl describe", logs: "kubectl logs",
                      logs_previous: "kubectl logs --previous", events: "Cluster events",
                    };
                    return (
                      <CollapsibleSection key={kind} label={labels[kind]}>
                        <pre style={{ background: "var(--c-bg-overlay)", color: "var(--c-text-secondary)", borderRadius: 6, padding: 10, fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto", margin: 0 }}>
                          {snap.content}
                        </pre>
                      </CollapsibleSection>
                    );
                  })}

                  {(detail.analyses ?? []).slice(-1).map((a: Analysis) => a.remediation ? (
                    <Section key={a.id} label="Proposed Remediation">
                      <div style={{ background: "var(--c-bg-raised)", border: "1px solid var(--c-sev2-bg)", borderRadius: 6, padding: 12, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--c-sev2)" }}>
                        {a.remediation}
                      </div>
                    </Section>
                  ) : null)}

                  <div style={{ display: "flex", gap: 10, marginTop: 8, paddingTop: 12, borderTop: "1px solid var(--c-border-strong)" }}>
                    <button
                      onClick={() => { setObjInput(detail.object); setObjFilter(detail.object); setDetail(null); setSelectedId(null); }}
                      style={{ background: "none", border: "none", color: "var(--c-accent-hover)", fontSize: 12, cursor: "pointer", padding: 0 }}
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

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: "var(--c-text-muted)", marginBottom: 4 }}>{children}</div>;
}

function MetaRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--c-text-muted)", textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</div>
      <div style={{ fontSize: 12, color: "var(--c-text-primary)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={title}>{value}</div>
    </div>
  );
}

function Section({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--c-text-muted)", letterSpacing: ".5px", marginBottom: 5 }}>{label}</div>
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
        <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--c-text-muted)" }}>{label}</span>
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
