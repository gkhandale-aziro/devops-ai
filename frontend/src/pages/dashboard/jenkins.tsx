/**
 * dashboard/jenkins.tsx — rich UI tabs for Jenkins targets.
 *
 * The Jenkins backend tab (`tools/jenkins.py`) emits JSON under the `output`
 * key for rich-UI tabs (overview, pipelines, agents). Builds and Queue still
 * render through GenericTab as plain text tables.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2,
  Search, Server, Sparkles, TrendingUp, X,
} from "lucide-react";
import { api } from "../../api/client";
import {
  BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Target } from "../../types";
import { Card, RingChart } from "./primitives";
import { AIDrawer } from "../../components/AIDrawer";
import { EmptyState } from "../../components/ui/empty-state";
import { C, FONT_SIZE, FONT_WEIGHT, RADIUS, SHADOW, SPACE } from "../../utils/theme";

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Pull the JSON payload from `data.output` — Jenkins handlers emit one string. */
function payload<T>(data: Record<string, string>, fallback: T): T {
  try {
    return JSON.parse(data.output ?? "") as T;
  } catch {
    return fallback;
  }
}

function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtRelative(ts: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const _STATUS_COLORS: Record<string, string> = {
  success:  C.status.success,
  failed:   C.status.danger,
  failure:  C.status.danger,
  unstable: C.status.warning,
  aborted:  C.text.muted,
  disabled: C.text.muted,
  notbuilt: C.text.muted,
  pending:  C.text.secondary,
  running:  C.status.info,
};

function statusColor(s: string) {
  return _STATUS_COLORS[(s || "").toLowerCase()] ?? C.text.secondary;
}

function StatusPill({ status, animated }: { status: string; animated?: boolean }) {
  const color = statusColor(status);
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : "Unknown";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "2px 8px", borderRadius: RADIUS.sm,
      fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold,
      color, background: `${color}1c`, border: `1px solid ${color}44`,
      whiteSpace: "nowrap",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%", background: color,
        animation: animated ? "pulse 1.4s ease-in-out infinite" : undefined,
        boxShadow: animated ? `0 0 6px ${color}` : undefined,
      }} />
      {label}
    </span>
  );
}

function ErrorBanner({ error }: { error: string }) {
  return (
    <div style={{
      margin: SPACE.lg, padding: `${SPACE.md}px ${SPACE.lg}px`,
      background: C.error.bg, border: `1px solid ${C.status.danger}44`,
      borderRadius: RADIUS.lg, color: C.status.danger,
      fontSize: FONT_SIZE.md, display: "flex", alignItems: "center", gap: SPACE.sm,
    }}>
      <AlertTriangle size={16} />
      <span>{error}</span>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

interface OverviewPayload {
  jobs_total: number;
  success_rate: number;
  running: number;
  queue_len: number;
  nodes_online: number;
  nodes_total: number;
  mode?: string;
  url?: string;
  error?: string;
  activity_24h?: { hour: number; success: number; failure: number; other: number }[];
}

export function JenkinsOverviewTab({ data }: { data: Record<string, string>; target?: Target }) {
  const p = payload<OverviewPayload>(data, {
    jobs_total: 0, success_rate: 0, running: 0, queue_len: 0,
    nodes_online: 0, nodes_total: 0,
  });

  const chart = useMemo(() => (p.activity_24h ?? []).map(b => ({
    label: new Date(b.hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    success: b.success, failure: b.failure, other: b.other,
  })), [p.activity_24h]);

  const nodeHealth = p.nodes_total > 0 ? Math.round(p.nodes_online / p.nodes_total * 100) : 0;
  const successColor = p.success_rate >= 80 ? C.status.success
                     : p.success_rate >= 50 ? C.status.warning
                     : C.status.danger;

  return (
    <div style={{ overflowY: "auto", padding: SPACE.lg, flex: 1 }}>
      {p.error && <ErrorBanner error={p.error} />}

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: SPACE.md, marginBottom: SPACE.lg,
      }}>
        <KPI label="Success rate" value={`${p.success_rate}%`}
             sub={`${p.jobs_total} jobs total`}
             color={successColor} ringPct={p.success_rate} />
        <KPI label="Running now" value={p.running}
             sub={p.running > 0 ? "Active builds" : "Idle"}
             color={p.running > 0 ? C.status.info : C.text.muted}
             icon={<Activity size={22} />} />
        <KPI label="Queue" value={p.queue_len}
             sub={p.queue_len > 0 ? "Waiting for executors" : "Empty"}
             color={p.queue_len > 0 ? C.status.warning : C.text.muted}
             icon={<Clock size={22} />} />
        <KPI label="Agents online" value={`${p.nodes_online}/${p.nodes_total}`}
             sub={p.mode || "Normal"}
             color={nodeHealth === 100 ? C.status.success
                  : nodeHealth >= 50  ? C.status.warning
                  : C.status.danger}
             ringPct={nodeHealth} />
      </div>

      {chart.length > 0 && (
        <div style={{
          background: C.bg.card, border: `1px solid ${C.border.muted}`,
          borderRadius: RADIUS.xl, padding: SPACE.md, marginBottom: SPACE.lg,
        }}>
          <div style={{
            fontSize: FONT_SIZE.sm, color: C.text.muted, marginBottom: SPACE.sm,
            fontWeight: FONT_WEIGHT.semibold,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <TrendingUp size={13} /> Build activity — last 24h
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chart} barCategoryGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border.subtle} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.text.muted }} tickLine={false} axisLine={{ stroke: C.border.muted }} />
              <YAxis tick={{ fontSize: 10, fill: C.text.muted }} tickLine={false} axisLine={{ stroke: C.border.muted }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: C.bg.elevated, border: `1px solid ${C.border.muted}`, borderRadius: RADIUS.md, fontSize: FONT_SIZE.sm }}
                       cursor={{ fill: `${C.accent.primary}11` }} />
              <Bar dataKey="success" stackId="a" fill={C.status.success} />
              <Bar dataKey="failure" stackId="a" fill={C.status.danger} />
              <Bar dataKey="other"   stackId="a" fill={C.text.muted} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <Card title="Controller">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACE.md, fontSize: FONT_SIZE.md }}>
          <InfoRow label="URL" value={p.url ? (
            <a href={p.url} target="_blank" rel="noreferrer" style={{ color: C.accent.light, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
              {p.url} <ExternalLink size={12} />
            </a>
          ) : "—"} />
          <InfoRow label="Mode" value={p.mode || "—"} />
          <InfoRow label="Jobs total" value={String(p.jobs_total)} />
          <InfoRow label="Success rate" value={`${p.success_rate}%`} />
        </div>
      </Card>
    </div>
  );
}

function KPI({
  label, value, sub, color, ringPct, icon,
}: {
  label: string; value: string | number; sub?: string;
  color?: string; ringPct?: number; icon?: React.ReactNode;
}) {
  const c = color ?? C.accent.primary;
  return (
    <div style={{
      background: C.bg.card, border: `1px solid ${C.border.muted}`,
      borderRadius: RADIUS.xl, padding: SPACE.lg, boxShadow: SHADOW.md,
      display: "flex", alignItems: "center", gap: SPACE.md, minWidth: 0,
    }}>
      {typeof ringPct === "number"
        ? <RingChart pct={ringPct} color={c} size={52} />
        : <div style={{
            width: 52, height: 52, borderRadius: "50%",
            background: `${c}18`, border: `2px solid ${c}33`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: c, flexShrink: 0,
          }}>{icon}</div>
      }
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: FONT_SIZE.xs, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: SPACE.xs }}>{label}</div>
        <div style={{ fontSize: FONT_SIZE.xxl, fontWeight: FONT_WEIGHT.bold, color: c, lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: FONT_SIZE.xs, color: C.text.muted, marginTop: SPACE.xs, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: FONT_SIZE.xs, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: SPACE.xs }}>{label}</div>
      <div style={{ color: C.text.primary, fontSize: FONT_SIZE.md, fontWeight: FONT_WEIGHT.medium, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

// ── Pipelines ─────────────────────────────────────────────────────────────────

interface PipelineRow {
  name: string;
  full_name: string;
  url: string;
  status: string;
  building: boolean;
  buildable: boolean;
  last_number: number | null;
  last_result: string | null;
  last_timestamp: number;
  last_duration: number;
  last_url: string;
  health_score: number | null;
  health_desc: string;
  is_pipeline: boolean;
}

type SortKey = "name" | "status" | "last" | "duration" | "health";

export function JenkinsPipelinesTab({ data, target }: { data: Record<string, string>; target?: Target }) {
  const p = payload<{ pipelines?: PipelineRow[]; error?: string }>(data, { pipelines: [] });
  const [q, setQ]       = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [asc, setAsc]   = useState(true);
  const [aiOpen,    setAiOpen]    = useState(false);
  const [aiContext, setAiContext] = useState("");
  const [aiTitle,   setAiTitle]   = useState("");
  const [buildOpen, setBuildOpen] = useState(false);
  const [buildFor,  setBuildFor]  = useState<PipelineRow | null>(null);

  function openBuildFor(j: PipelineRow) {
    if (j.last_number == null) return;
    setBuildFor(j);
    setBuildOpen(true);
  }

  function openAIForPipeline(j: PipelineRow) {
    const when = j.last_timestamp ? new Date(j.last_timestamp).toISOString() : "never";
    const displayStatus = j.building ? "running" : (j.status || "unknown");
    const prompt =
      `You are a CI/CD SRE. Analyze this Jenkins pipeline and give a concise read on its health, ` +
      `likely root causes if it's failing/unstable, and next steps to investigate or remediate.\n\n` +
      `Jenkins target: ${target?.name ?? "—"} (${target?.config?.url ?? "—"})\n` +
      `Pipeline: ${j.full_name || j.name}\n` +
      `Status: ${displayStatus}\n` +
      `Buildable: ${j.buildable}\n` +
      `Is pipeline job: ${j.is_pipeline}\n` +
      `Last build: ${j.last_number != null ? "#" + j.last_number : "none"}\n` +
      `Last result: ${j.last_result ?? "—"}\n` +
      `Last build time: ${when}\n` +
      `Last duration: ${fmtDuration(j.last_duration)}\n` +
      `Health score: ${j.health_score != null ? j.health_score + "%" : "—"}\n` +
      `Health description: ${j.health_desc || "—"}\n` +
      `Last build URL: ${j.last_url || "—"}`;
    setAiContext(prompt);
    setAiTitle(`AI: ${j.name}`);
    setAiOpen(true);
  }

  function openAIForAll() {
    const rowsForAI = (p.pipelines ?? []);
    const summary = rowsForAI.map(j => {
      const st = j.building ? "running" : (j.status || "unknown");
      const last = j.last_number != null ? `#${j.last_number} ${j.last_result ?? ""}`.trim() : "—";
      const health = j.health_score != null ? `${j.health_score}%` : "—";
      return `- ${j.name}: status=${st}, last=${last}, duration=${fmtDuration(j.last_duration)}, health=${health}`;
    }).join("\n");
    const prompt =
      `You are a CI/CD SRE reviewing a Jenkins controller. Here are the pipelines and their latest state. ` +
      `Identify risks, unhealthy jobs, patterns across failures/unstable builds, and suggest priorities for remediation.\n\n` +
      `Target: ${target?.name ?? "—"} (${target?.config?.url ?? "—"})\n` +
      `Pipelines (${rowsForAI.length}):\n${summary || "(none)"}`;
    setAiContext(prompt);
    setAiTitle(`AI: Jenkins pipelines overview`);
    setAiOpen(true);
  }

  const rows = useMemo(() => {
    let list = p.pipelines ?? [];
    if (q) {
      const qq = q.toLowerCase();
      list = list.filter(j => j.name.toLowerCase().includes(qq) || j.full_name.toLowerCase().includes(qq));
    }
    const dir = asc ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sort) {
        case "name":     return a.name.localeCompare(b.name) * dir;
        case "status":   return (a.status || "").localeCompare(b.status || "") * dir;
        case "last":     return ((a.last_timestamp || 0) - (b.last_timestamp || 0)) * dir;
        case "duration": return ((a.last_duration  || 0) - (b.last_duration  || 0)) * dir;
        case "health":   return ((a.health_score  ?? -1) - (b.health_score  ?? -1)) * dir;
      }
    });
  }, [p.pipelines, q, sort, asc]);

  const summary = useMemo(() => {
    const bucket = { success: 0, failed: 0, unstable: 0, running: 0, other: 0 };
    for (const j of rows) {
      const k = j.building ? "running" : (j.status || "other") as keyof typeof bucket;
      if (k in bucket) bucket[k as keyof typeof bucket]++;
      else bucket.other++;
    }
    return bucket;
  }, [rows]);

  function toggleSort(key: SortKey) {
    if (sort === key) setAsc(a => !a);
    else { setSort(key); setAsc(true); }
  }

  if (p.error) return <ErrorBanner error={p.error} />;
  if (!(p.pipelines ?? []).length) {
    return <EmptyState icon={<Activity size={32} />} title="No pipelines" description="Jenkins reported no jobs." />;
  }

  return (
    <>
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: SPACE.lg,
        padding: `${SPACE.sm}px ${SPACE.lg}px`,
        background: C.bg.panel, borderBottom: `1px solid ${C.border.subtle}`, flexShrink: 0,
      }}>
        <span style={{ fontSize: FONT_SIZE.md, fontWeight: FONT_WEIGHT.semibold, color: C.text.primary }}>
          {rows.length} Pipelines
        </span>
        <div style={{ width: 1, height: SPACE.xl, background: C.border.muted }} />
        <SummaryChip label="Success"  count={summary.success}  color={C.status.success} />
        <SummaryChip label="Failed"   count={summary.failed}   color={C.status.danger} />
        <SummaryChip label="Unstable" count={summary.unstable} color={C.status.warning} />
        <SummaryChip label="Running"  count={summary.running}  color={C.status.info} pulse />
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={openAIForAll}
          title="Get an AI summary of all pipelines"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: `${C.accent.primary}1c`,
            border: `1px solid ${C.accent.primary}55`,
            color: C.accent.light,
            borderRadius: RADIUS.md,
            padding: "5px 10px",
            fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold,
            cursor: "pointer",
          }}
        >
          <Sparkles size={13} /> Analyze all
        </button>
        <FilterBox value={q} onChange={setQ} placeholder="Filter pipelines…" />
      </div>

      <div style={{ overflow: "auto", flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT_SIZE.sm }}>
          <thead>
            <tr style={{ background: C.bg.panel, position: "sticky", top: 0, zIndex: 1 }}>
              <Th label="Name"       k="name"     s={sort} a={asc} on={() => toggleSort("name")} />
              <Th label="Status"     k="status"   s={sort} a={asc} on={() => toggleSort("status")} />
              <Th label="Last build" k="last"     s={sort} a={asc} on={() => toggleSort("last")} />
              <Th label="Duration"   k="duration" s={sort} a={asc} on={() => toggleSort("duration")} />
              <Th label="Health"     k="health"   s={sort} a={asc} on={() => toggleSort("health")} />
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(j => (
              <tr key={j.full_name || j.name} style={{ borderBottom: `1px solid ${C.border.subtle}` }}>
                <td style={tdStyle}>
                  <span style={{ color: C.text.primary, fontWeight: FONT_WEIGHT.medium }}>{j.name}</span>
                  {!j.buildable && <span style={{ marginLeft: 8, fontSize: FONT_SIZE.xs, color: C.text.muted }}>(disabled)</span>}
                  {j.is_pipeline && <span style={{ marginLeft: 8, fontSize: FONT_SIZE.xs, color: C.accent.light }}>pipeline</span>}
                </td>
                <td style={tdStyle}>
                  {j.last_number != null ? (
                    <button
                      type="button"
                      onClick={() => openBuildFor(j)}
                      title={`View build #${j.last_number} — logs, stages, AI analysis`}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
                    >
                      <StatusPill status={j.building ? "running" : (j.status || "unknown")} animated={j.building} />
                    </button>
                  ) : (
                    <StatusPill status={j.building ? "running" : (j.status || "unknown")} animated={j.building} />
                  )}
                </td>
                <td style={tdStyle}>
                  {j.last_number != null ? (
                    <span style={{ color: C.text.secondary }}>
                      #{j.last_number}
                      <span style={{ color: C.text.muted }}> · {fmtRelative(j.last_timestamp)}</span>
                    </span>
                  ) : <span style={{ color: C.text.muted }}>—</span>}
                </td>
                <td style={{ ...tdStyle, color: C.text.secondary, fontFamily: "monospace" }}>{fmtDuration(j.last_duration)}</td>
                <td style={tdStyle}>
                  {j.health_score != null ? <HealthBar score={j.health_score} title={j.health_desc} /> : <span style={{ color: C.text.muted }}>—</span>}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: SPACE.sm }}>
                    <button
                      type="button"
                      onClick={() => openAIForPipeline(j)}
                      title="AI analysis of this pipeline"
                      style={{
                        background: "transparent", border: "none", padding: 2,
                        color: C.accent.light, cursor: "pointer",
                        display: "inline-flex", alignItems: "center",
                      }}
                    >
                      <Sparkles size={14} />
                    </button>
                    {j.url && (
                      <a href={j.url} target="_blank" rel="noreferrer" style={{ color: C.text.muted, display: "inline-flex", alignItems: "center" }} title="Open in Jenkins">
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    <AIDrawer open={aiOpen} context={aiContext} title={aiTitle} onClose={() => setAiOpen(false)} />
    <BuildDetailsDrawer
      open={buildOpen}
      target={target}
      pipeline={buildFor}
      onClose={() => setBuildOpen(false)}
      onAnalyze={(title, context) => { setAiTitle(title); setAiContext(context); setAiOpen(true); }}
    />
    </>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left", padding: `${SPACE.sm}px ${SPACE.md}px`,
  fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.bold,
  color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px",
  borderBottom: `1px solid ${C.border.muted}`, whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = {
  padding: `${SPACE.sm}px ${SPACE.md}px`, verticalAlign: "middle",
};

function Th({ label, k, s, a, on }: { label: string; k: SortKey; s: SortKey; a: boolean; on: () => void }) {
  const active = s === k;
  return (
    <th style={{ ...thStyle, cursor: "pointer", userSelect: "none" }} onClick={on}>
      <span style={{ color: active ? C.text.primary : undefined }}>
        {label}{active && <span style={{ marginLeft: 4, fontSize: FONT_SIZE.xs }}>{a ? "↑" : "↓"}</span>}
      </span>
    </th>
  );
}

function HealthBar({ score, title }: { score: number; title?: string }) {
  const color = score >= 80 ? C.status.success : score >= 50 ? C.status.warning : C.status.danger;
  return (
    <div title={title} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 60, height: 6, background: C.border.subtle, borderRadius: RADIUS.sm, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(0, Math.min(100, score))}%`, height: "100%", background: color, transition: "width .4s" }} />
      </div>
      <span style={{ color, fontSize: FONT_SIZE.xs, fontVariantNumeric: "tabular-nums", minWidth: 28, textAlign: "right" }}>{score}%</span>
    </div>
  );
}

function SummaryChip({ label, count, color, pulse }: { label: string; count: number; color: string; pulse?: boolean }) {
  const dim = count === 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: SPACE.xs }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%",
        background: dim ? C.border.strong : color,
        animation: pulse && !dim ? "pulse 1.4s ease-in-out infinite" : undefined,
        boxShadow: pulse && !dim ? `0 0 6px ${color}` : undefined,
      }} />
      <span style={{ fontSize: FONT_SIZE.sm, color: dim ? C.text.muted : color, fontWeight: FONT_WEIGHT.semibold }}>{count}</span>
      <span style={{ fontSize: FONT_SIZE.sm, color: C.text.muted }}>{label}</span>
    </div>
  );
}

function FilterBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div style={{ position: "relative" }}>
      <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: C.text.muted }} />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background: C.bg.elevated, border: `1px solid ${C.border.muted}`, color: C.text.primary,
          borderRadius: RADIUS.md, padding: "5px 10px 5px 26px", fontSize: FONT_SIZE.sm,
          outline: "none", width: 200,
        }}
      />
    </div>
  );
}

// ── Agents ────────────────────────────────────────────────────────────────────

interface AgentRow {
  name: string;
  offline: boolean;
  temp_offline: boolean;
  idle: boolean;
  executors: number;
  busy: number;
  reason: string;
  response_ms: number | null;
  arch: string;
}

export function JenkinsAgentsTab({ data, target }: { data: Record<string, string>; target?: Target }) {
  const p = payload<{ agents?: AgentRow[]; error?: string }>(data, { agents: [] });
  const [aiOpen,    setAiOpen]    = useState(false);
  const [aiContext, setAiContext] = useState("");
  const [aiTitle,   setAiTitle]   = useState("");

  function openAIForAgent(n: AgentRow) {
    const status = n.offline ? "offline"
                 : n.temp_offline ? "temporarily offline"
                 : n.busy > 0 ? "busy" : "idle";
    const prompt =
      `You are a CI/CD SRE. Analyze this Jenkins build agent's health and capacity, ` +
      `call out risks (offline, saturated, slow response, disconnected), and suggest next steps to investigate or remediate.\n\n` +
      `Jenkins target: ${target?.name ?? "—"} (${target?.config?.url ?? "—"})\n` +
      `Agent name: ${n.name}\n` +
      `Status: ${status}\n` +
      `Executors: ${n.busy}/${n.executors} busy\n` +
      `Response time: ${typeof n.response_ms === "number" ? Math.round(n.response_ms) + " ms" : "—"}\n` +
      `Architecture: ${n.arch || "—"}\n` +
      `Offline reason: ${n.reason || "—"}`;
    setAiContext(prompt);
    setAiTitle(`AI: ${n.name}`);
    setAiOpen(true);
  }

  if (p.error) return <ErrorBanner error={p.error} />;
  if (!(p.agents ?? []).length) {
    return <EmptyState icon={<Server size={32} />} title="No agents" description="No build agents registered with this controller." />;
  }

  return (
    <>
    <div style={{ overflowY: "auto", padding: SPACE.lg, flex: 1 }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: SPACE.md,
      }}>
        {(p.agents ?? []).map(n => {
          const pct = n.executors > 0 ? Math.round(n.busy / n.executors * 100) : 0;
          const color = n.offline ? C.status.danger
                      : n.temp_offline ? C.status.warning
                      : (n.busy > 0 ? C.status.info : C.status.success);
          const statusLabel = n.offline ? "offline"
                            : n.temp_offline ? "temp offline"
                            : n.busy > 0 ? "running" : "success"; // reuse known palette
          return (
            <div key={n.name} style={{
              background: C.bg.card, border: `1px solid ${C.border.muted}`,
              borderRadius: RADIUS.xl, padding: SPACE.lg, boxShadow: SHADOW.md,
              display: "flex", flexDirection: "column", gap: SPACE.md,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: SPACE.md }}>
                <div style={{
                  width: 40, height: 40, borderRadius: "50%",
                  background: `${color}18`, color,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <Server size={18} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: C.text.primary, fontWeight: FONT_WEIGHT.semibold, fontSize: FONT_SIZE.md, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {n.name}
                  </div>
                  <div style={{ marginTop: 2 }}>
                    <StatusPill status={statusLabel} animated={n.busy > 0 && !n.offline} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openAIForAgent(n)}
                  title="AI analysis of this agent"
                  style={{
                    background: `${C.accent.primary}1c`,
                    border: `1px solid ${C.accent.primary}55`,
                    color: C.accent.light,
                    borderRadius: RADIUS.md,
                    padding: "4px 8px",
                    cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 4,
                    fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.semibold,
                    flexShrink: 0,
                  }}
                >
                  <Sparkles size={12} /> Analyze
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: SPACE.md }}>
                <RingChart pct={pct} color={color} size={56} />
                <div>
                  <div style={{ fontSize: FONT_SIZE.xs, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 2 }}>Executors</div>
                  <div style={{ fontSize: FONT_SIZE.xl, fontWeight: FONT_WEIGHT.bold, color: C.text.primary, lineHeight: 1 }}>{n.busy}/{n.executors}</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACE.sm, fontSize: FONT_SIZE.sm }}>
                <MetaPair label="Response" value={typeof n.response_ms === "number" ? `${Math.round(n.response_ms)} ms` : "—"} />
                <MetaPair label="Arch" value={n.arch || "—"} />
              </div>

              {n.reason && (
                <div style={{
                  background: C.error.bg, color: C.status.danger,
                  border: `1px solid ${C.status.danger}33`, borderRadius: RADIUS.md,
                  padding: `${SPACE.xs}px ${SPACE.sm}px`, fontSize: FONT_SIZE.xs,
                }}>
                  {n.reason}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ textAlign: "center", marginTop: SPACE.lg, color: C.text.muted, fontSize: FONT_SIZE.xs, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <CheckCircle2 size={12} /> {(p.agents ?? []).filter(a => !a.offline).length} of {(p.agents ?? []).length} agents online
      </div>
    </div>
    <AIDrawer open={aiOpen} context={aiContext} title={aiTitle} onClose={() => setAiOpen(false)} />
    </>
  );
}

function MetaPair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: FONT_SIZE.xs, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 2 }}>{label}</div>
      <div style={{ color: C.text.secondary, fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}

// ── Build details drawer (logs + stages + AI) ────────────────────────────────

type BuildDetails = Awaited<ReturnType<typeof api.jenkinsBuild>>;

function BuildDetailsDrawer({
  open, target, pipeline, onClose, onAnalyze,
}: {
  open: boolean;
  target?: Target;
  pipeline: PipelineRow | null;
  onClose: () => void;
  onAnalyze: (title: string, context: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [det, setDet] = useState<BuildDetails | null>(null);

  useEffect(() => {
    if (!open || !target || !pipeline || pipeline.last_number == null) return;
    const ac = new AbortController();
    setLoading(true); setErr(null); setDet(null);
    api.jenkinsBuild(target.id, pipeline.full_name || pipeline.name, pipeline.last_number)
      .then(d => { if (!ac.signal.aborted) setDet(d); })
      .catch(e => { if (!ac.signal.aborted) setErr(String(e?.message ?? e)); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [open, target, pipeline]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open || !pipeline) return null;

  function handleAnalyze() {
    if (!det || !pipeline) return;
    const m = det.meta;
    const when = m?.timestamp ? new Date(m.timestamp).toISOString() : "—";
    const causes = (m?.causes ?? []).map(c => `${c.description}${c.user ? ` (user: ${c.user})` : ""}`).join("; ") || "—";
    const params = (m?.parameters ?? []).map(p => `${p.name}=${p.value}`).join(", ") || "—";
    const commits = (m?.commits ?? []).slice(0, 10)
      .map(c => `  - ${c.commit} ${c.author}: ${c.message.replace(/\n/g, " ")}`)
      .join("\n") || "  (none)";
    const hasStages = (det.stages ?? []).length > 0;
    const stages = hasStages
      ? det.stages.map(s =>
          `  - ${s.name}: ${s.status}${s.duration ? ` (${fmtDuration(s.duration)})` : ""}${s.error ? ` — ${s.error}` : ""}`
        ).join("\n")
      : "  (no Workflow stages reported — this is likely a freestyle job, not a declarative/scripted pipeline)";
    const log = det.log_tail ? det.log_tail.slice(-8000) : "(no log)";

    const prompt =
      `You are a CI/CD SRE. Analyze this Jenkins build and produce a structured report. ` +
      `Respond in markdown using EXACTLY these sections, in this order:\n\n` +
      `### Summary\n` +
      `One or two sentences: what this build did and whether it succeeded/failed/is running.\n\n` +
      `### Trigger\n` +
      `Who or what started this build (from the "Triggered by" field). Include the user if present.\n\n` +
      `### Stages\n` +
      `${hasStages
        ? `Render every stage listed below as a markdown table with columns: Stage | Status | Duration | Notes. Preserve the order given. Mark failing stages clearly and call out the one where things broke.`
        : `State plainly that no pipeline stages are available (this is a freestyle job, not a declarative/scripted pipeline). Do not fabricate stages.`}\n\n` +
      `### Root cause\n` +
      `${m?.result === "FAILURE" || m?.result === "UNSTABLE"
        ? `Identify the specific failure from the console log tail. Quote the exact error line(s). Map the failure back to a stage when possible.`
        : `If the build succeeded, note any warnings worth watching. Otherwise say "n/a".`}\n\n` +
      `### Next steps\n` +
      `Concrete, actionable bullets — what to investigate, what to fix, commands or files to check.\n\n` +
      `--- Build context ---\n` +
      `Target: ${target?.name ?? "—"} (${target?.config?.url ?? "—"})\n` +
      `Pipeline: ${pipeline.full_name || pipeline.name}\n` +
      `Build: #${m?.number ?? pipeline.last_number}\n` +
      `Result: ${m?.result ?? (m?.building ? "RUNNING" : "—")}\n` +
      `Started: ${when}\n` +
      `Duration: ${fmtDuration(m?.duration || 0)}\n` +
      `URL: ${m?.url || "—"}\n` +
      `Triggered by: ${causes}\n` +
      `Parameters: ${params}\n` +
      `Commits in this build:\n${commits}\n` +
      `Stages (${det.stages.length}):\n${stages}\n\n` +
      `Console log (tail${det.log_truncated ? ", truncated" : ""}):\n` +
      "```\n" + log + "\n```";
    onAnalyze(`AI: ${pipeline.name} #${m?.number ?? pipeline.last_number}`, prompt);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        zIndex: 1000, display: "flex", justifyContent: "flex-end",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(720px, 92vw)", height: "100%",
          background: C.bg.panel, borderLeft: `1px solid ${C.border.muted}`,
          display: "flex", flexDirection: "column",
          boxShadow: "0 0 30px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: SPACE.md,
          padding: `${SPACE.md}px ${SPACE.lg}px`,
          borderBottom: `1px solid ${C.border.subtle}`, flexShrink: 0,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: FONT_SIZE.md, fontWeight: FONT_WEIGHT.semibold, color: C.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pipeline.name} <span style={{ color: C.text.muted, fontWeight: FONT_WEIGHT.normal }}>#{pipeline.last_number}</span>
            </div>
            <div style={{ fontSize: FONT_SIZE.xs, color: C.text.muted, marginTop: 2 }}>
              {pipeline.full_name || pipeline.name}
            </div>
          </div>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={!det || loading}
            title="AI analysis with full build context"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: `${C.accent.primary}1c`,
              border: `1px solid ${C.accent.primary}55`,
              color: C.accent.light,
              borderRadius: RADIUS.md,
              padding: "6px 12px",
              fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold,
              cursor: det && !loading ? "pointer" : "not-allowed",
              opacity: det && !loading ? 1 : 0.5,
            }}
          >
            <Sparkles size={13} /> AI analysis
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", color: C.text.muted, cursor: "pointer", padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ overflow: "auto", flex: 1, padding: SPACE.lg }}>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm, color: C.text.muted, fontSize: FONT_SIZE.sm }}>
              <Loader2 size={14} className="spin" /> Loading build details…
            </div>
          )}
          {err && <ErrorBanner error={err} />}
          {det?.error && <ErrorBanner error={det.error} />}

          {det?.meta && <BuildMeta meta={det.meta} />}
          {det && det.stages.length > 0 && <StagesPanel stages={det.stages} />}
          {det && <LogsPanel log={det.log_tail} truncated={det.log_truncated} />}
        </div>
      </div>
    </div>
  );
}

function BuildMeta({ meta }: { meta: NonNullable<BuildDetails["meta"]> }) {
  const when = meta.timestamp ? new Date(meta.timestamp).toLocaleString() : "—";
  const resultColor = statusColor((meta.result || (meta.building ? "running" : "unknown")).toLowerCase());
  return (
    <div style={{
      background: C.bg.card, border: `1px solid ${C.border.muted}`,
      borderRadius: RADIUS.lg, padding: SPACE.md, marginBottom: SPACE.md,
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACE.md, fontSize: FONT_SIZE.sm }}>
        <InfoRow label="Result" value={
          <span style={{ color: resultColor, fontWeight: FONT_WEIGHT.semibold }}>
            {meta.result || (meta.building ? "RUNNING" : "—")}
          </span>
        } />
        <InfoRow label="Started" value={when} />
        <InfoRow label="Duration" value={fmtDuration(meta.duration)} />
        <InfoRow label="Build URL" value={meta.url
          ? <a href={meta.url} target="_blank" rel="noreferrer" style={{ color: C.accent.light, display: "inline-flex", alignItems: "center", gap: 4 }}>Open <ExternalLink size={12} /></a>
          : "—"} />
      </div>

      {meta.causes.length > 0 && (
        <div style={{ marginTop: SPACE.md }}>
          <div style={{ fontSize: FONT_SIZE.xs, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: SPACE.xs }}>Triggered by</div>
          {meta.causes.map((c, i) => (
            <div key={i} style={{ color: C.text.secondary, fontSize: FONT_SIZE.sm }}>
              {c.description}{c.user && <span style={{ color: C.text.muted }}> — user: {c.user}</span>}
            </div>
          ))}
        </div>
      )}

      {meta.parameters.length > 0 && (
        <div style={{ marginTop: SPACE.md }}>
          <div style={{ fontSize: FONT_SIZE.xs, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: SPACE.xs }}>Parameters</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACE.xs, fontSize: FONT_SIZE.sm, fontFamily: "monospace" }}>
            {meta.parameters.map((p, i) => (
              <div key={i} style={{ color: C.text.secondary }}>
                <span style={{ color: C.text.muted }}>{p.name}=</span>{p.value}
              </div>
            ))}
          </div>
        </div>
      )}

      {meta.commits.length > 0 && (
        <div style={{ marginTop: SPACE.md }}>
          <div style={{ fontSize: FONT_SIZE.xs, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: SPACE.xs }}>Changes ({meta.commits.length})</div>
          {meta.commits.slice(0, 10).map((c, i) => (
            <div key={i} style={{ color: C.text.secondary, fontSize: FONT_SIZE.sm, marginBottom: 2 }}>
              <span style={{ color: C.accent.light, fontFamily: "monospace" }}>{c.commit}</span>
              {" "}<span style={{ color: C.text.muted }}>{c.author}:</span> {c.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StagesPanel({ stages }: { stages: BuildDetails["stages"] }) {
  return (
    <div style={{
      background: C.bg.card, border: `1px solid ${C.border.muted}`,
      borderRadius: RADIUS.lg, padding: SPACE.md, marginBottom: SPACE.md,
    }}>
      <div style={{ fontSize: FONT_SIZE.xs, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: SPACE.sm, fontWeight: FONT_WEIGHT.semibold }}>
        Stages ({stages.length})
      </div>
      {stages.map((s, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: SPACE.md,
          padding: `${SPACE.xs}px 0`,
          borderTop: i === 0 ? "none" : `1px solid ${C.border.subtle}`,
        }}>
          <StatusPill status={(s.status || "").toLowerCase()} />
          <div style={{ flex: 1, color: C.text.primary, fontSize: FONT_SIZE.sm }}>{s.name}</div>
          <div style={{ color: C.text.muted, fontSize: FONT_SIZE.sm, fontFamily: "monospace" }}>{fmtDuration(s.duration)}</div>
        </div>
      ))}
      {stages.some(s => s.error) && (
        <div style={{ marginTop: SPACE.sm }}>
          {stages.filter(s => s.error).map((s, i) => (
            <div key={i} style={{
              background: C.error.bg, color: C.status.danger,
              border: `1px solid ${C.status.danger}33`, borderRadius: RADIUS.md,
              padding: `${SPACE.xs}px ${SPACE.sm}px`, fontSize: FONT_SIZE.xs,
              marginTop: SPACE.xs, fontFamily: "monospace",
            }}>
              <strong>{s.name}:</strong> {s.error}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LogsPanel({ log, truncated }: { log: string; truncated: boolean }) {
  return (
    <div style={{
      background: C.bg.card, border: `1px solid ${C.border.muted}`,
      borderRadius: RADIUS.lg, padding: SPACE.md,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: SPACE.sm,
        fontSize: FONT_SIZE.xs, color: C.text.muted, textTransform: "uppercase",
        letterSpacing: ".5px", marginBottom: SPACE.sm, fontWeight: FONT_WEIGHT.semibold,
      }}>
        Console log {truncated && <span style={{ color: C.status.warning, textTransform: "none" }}>(tail — truncated)</span>}
      </div>
      <pre style={{
        background: C.bg.elevated, color: C.text.secondary,
        border: `1px solid ${C.border.subtle}`, borderRadius: RADIUS.md,
        padding: SPACE.sm, fontSize: FONT_SIZE.xs, fontFamily: "monospace",
        maxHeight: 420, overflow: "auto", margin: 0,
        whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>{log || "(no output)"}</pre>
    </div>
  );
}
