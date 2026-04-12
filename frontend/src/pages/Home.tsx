import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Zap, Wifi, AlertTriangle, AlertCircle, Bell, LayoutGrid, MessageSquare, Clock, ArrowRight } from "lucide-react";
import { TARGET_META } from "../utils/targetIcons";
import type { Target, StoredEvent, TriageLevel } from "../types";
import { LEVEL_COLORS } from "../types";
import { api } from "../api/client";
import { HealthSummaryBar } from "../components/ui/health-summary";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT, SHADOW } from "../utils/theme";

interface Props {
  targets:       Target[];
  monitorActive: boolean;
}

function relativeTime(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (isNaN(diff) || diff < 0) return "just now";
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** Pure-SVG sparkline — no external library */
function Sparkline({ values, color, width = 80, height = 28 }: {
  values: number[]; color: string; width?: number; height?: number;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const polyline = pts.join(" ");
  const last = pts[pts.length - 1].split(",");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible" }}>
      {/* Filled area */}
      <defs>
        <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${polyline} ${width},${height}`}
        fill={`url(#sg-${color.replace("#","")})`}
      />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* End dot */}
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
}


export function Home({ targets, monitorActive }: Props) {
  const [recent,   setRecent]   = useState<StoredEvent[]>([]);
  const [counts,   setCounts]   = useState<Partial<Record<TriageLevel, number>>>({});
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    Promise.all([
      api.events.list({ limit: 8 }),
      api.stats(),
    ]).then(([evts, stats]) => {
      setRecent(evts);
      setCounts(stats.counts);
    }).catch(e => console.warn("[Home] events/stats load failed:", (e as Error)?.message))
      .finally(() => setLoading(false));
  }, []);

  const online    = targets.filter(t => t.status === "online").length;
  const offline   = targets.filter(t => t.status === "offline").length;
  const criticals = counts.SEV1 ?? 0;
  const warnings  = counts.SEV2 ?? 0;

  return (
    <div id="main" style={{ flex: 1, overflowY: "auto", background: C.bg.base }}>
      <div style={{ maxWidth: 1600, margin: "0 auto", padding: `${SPACE.xxl + SPACE.md}px ${SPACE.xxl + SPACE.sm}px` }}>

        {/* ── Page header ───────────────────────────────────────────────── */}
        <div style={{ marginBottom: SPACE.xxl + SPACE.md, animation: "slideUp .3s ease-out" }}>
          <div style={{ display: "flex", alignItems: "center", gap: SPACE.md + SPACE.xxs, marginBottom: SPACE.md / 2 }}>
            <div style={{
              width: 40, height: 40, borderRadius: RADIUS.xl,
              background: `linear-gradient(135deg,${C.accent.primary} 0%,${C.accent.light} 100%)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: SHADOW.glow,
              flexShrink: 0,
            }}>
              <Zap size={20} fill="white" stroke="white" />
            </div>
            <div>
              <h1 style={{ fontSize: FONT_SIZE.xxl, fontWeight: FONT_WEIGHT.black, color: C.text.primary, letterSpacing: "-.5px", lineHeight: 1.2 }}>
                AziroOps
              </h1>
              <div style={{ fontSize: FONT_SIZE.sm + 1, color: C.text.muted, marginTop: SPACE.xxs, fontWeight: FONT_WEIGHT.medium }}>
                AI-powered DevOps command center
              </div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: SPACE.md / 2 }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: online > 0 ? C.status.success : C.text.muted,
                boxShadow: online > 0 ? `0 0 8px ${C.status.success}88` : "none",
                animation: online > 0 ? "pulse 2s infinite" : "none",
                display: "inline-block",
              }} />
              <span style={{ fontSize: FONT_SIZE.sm + 1, color: online > 0 ? C.status.success : C.text.muted, fontWeight: FONT_WEIGHT.semibold }}>
                {online > 0 ? `${online} online` : "No connections"}
              </span>
            </div>
          </div>
        </div>

        {/* ── Stat cards ────────────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: SPACE.md + SPACE.xxs, marginBottom: SPACE.xxl + SPACE.sm }}>
          <StatCard
            label="Connections"
            value={targets.length}
            sub={online > 0 ? `${online} online` : "none online"}
            color={C.accent.primary}

            warn={offline > 0 ? `${offline} offline` : undefined}
            loading={loading}
            icon={
              <Wifi size={16} />
            }
          />
          <StatCard
            label="Critical (SEV1)"
            value={loading ? "—" : criticals}
            sub="requiring action"
            color={criticals > 0 ? C.error.border : C.status.success}

            pulse={criticals > 0}
            loading={loading}
            icon={
              <AlertTriangle size={16} />
            }
          />
          <StatCard
            label="Warnings (SEV2)"
            value={loading ? "—" : warnings}
            sub="needs investigation"
            color={warnings > 0 ? C.status.warning : C.status.success}

            loading={loading}
            icon={
              <AlertCircle size={16} />
            }
          />
          <StatCard
            label="Monitor"
            value={monitorActive ? "Active" : "Idle"}
            sub={monitorActive ? "Watching live events" : "Start to capture events"}
            color={monitorActive ? C.status.success : C.text.muted}

            pulse={monitorActive}
            loading={false}
            icon={
              <Bell size={16} />
            }
          />
        </div>

        {/* ── Quick actions ─────────────────────────────────────────────── */}
        <Section label="Quick Actions">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: SPACE.md + SPACE.xxs }}>
            <ActionCard
              to="/alerts"
              label="Live Alerts"
              desc="Monitor infrastructure in real-time and get notified instantly"
              accent={C.error.border}
              icon={
                <Bell size={22} strokeWidth={1.8} />
              }
            />
            <ActionCard
              to="/dashboard"
              label="Dashboard"
              desc="Inspect pods, nodes, deployments and resource details"
              accent={C.accent.primary}
              icon={
                <LayoutGrid size={22} strokeWidth={1.8} />
              }
            />
            <ActionCard
              to="/chat"
              label="AI Chat"
              desc="Ask your AI assistant about infrastructure, incidents or DevOps"
              accent={C.accent.light}
              icon={
                <MessageSquare size={22} strokeWidth={1.8} />
              }
            />
          </div>
        </Section>

        {/* ── Recent activity ───────────────────────────────────────────── */}
        <Section label="Recent Incidents">
          <div style={{
            background: C.bg.card,
            border: `1px solid ${C.border.muted}`,
            borderRadius: RADIUS.xl, overflow: "hidden",
            boxShadow: SHADOW.md,
          }}>
            {loading ? (
              <div style={{ padding: `${SPACE.xl}px ${SPACE.xl - SPACE.xxs}px` }}>
                {[85, 60, 75, 55, 70].map((w, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: SPACE.md, marginBottom: SPACE.md + SPACE.xxs }}>
                    <div className="skeleton" style={{ width: 36, height: 18, borderRadius: RADIUS.sm, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div className="skeleton" style={{ height: FONT_SIZE.md, width: `${w}%`, marginBottom: SPACE.md / 2 }} />
                      <div className="skeleton" style={{ height: FONT_SIZE.xs, width: `${w - 20}%` }} />
                    </div>
                    <div className="skeleton" style={{ width: 40, height: FONT_SIZE.xs }} />
                  </div>
                ))}
              </div>
            ) : recent.length === 0 ? (
              <div style={{ padding: `48px ${SPACE.xl - SPACE.xxs}px`, textAlign: "center" }}>
                <Clock size={44} stroke={C.border.strong} strokeWidth={1.2} style={{ marginBottom: SPACE.md }} />
                <div style={{ fontSize: FONT_SIZE.md + 1, color: C.text.secondary, fontWeight: FONT_WEIGHT.semibold, marginBottom: SPACE.xs }}>No incidents recorded yet</div>
                <div style={{ fontSize: FONT_SIZE.sm + 1, color: C.text.muted }}>Start monitoring a target to capture events.</div>
              </div>
            ) : (
              recent.map((evt, i) => {
                const c = LEVEL_COLORS[evt.level as TriageLevel];
                return (
                  <Link
                    key={evt.id}
                    to="/history"
                    className="hover-bg-raised"
                    style={{
                      display: "flex", alignItems: "center", gap: SPACE.md + SPACE.xxs,
                      padding: `${SPACE.md}px ${SPACE.xl - SPACE.xxs}px`, textDecoration: "none",
                      borderBottom: i < recent.length - 1 ? `1px solid ${C.border.muted}` : "none",
                      borderLeft: `3px solid ${c?.border ?? C.border.strong}`,
                      transition: "background .15s",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{
                      fontSize: 9, fontWeight: FONT_WEIGHT.black, padding: `3px 7px`, borderRadius: RADIUS.sm + 1,
                      color: c?.text ?? C.text.primary,
                      background: c?.bg ?? "var(--c-bg-overlay)",
                      border: `1px solid ${c?.border ?? C.border.strong}`,
                      flexShrink: 0, letterSpacing: ".4px", textTransform: "uppercase",
                    }}>
                      {evt.level}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: FONT_SIZE.md, color: C.text.primary, fontWeight: FONT_WEIGHT.semibold, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {evt.reason} <span style={{ color: C.text.secondary, fontWeight: FONT_WEIGHT.normal }}>— {evt.object}</span>
                      </div>
                      {evt.message && (
                        <div style={{ fontSize: FONT_SIZE.sm, color: C.text.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: SPACE.xxs }}>
                          {evt.message}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                      <span style={{ fontSize: FONT_SIZE.sm, color: C.text.faint }}>{relativeTime(evt.timestamp)}</span>
                      <span style={{
                        fontSize: 9, fontWeight: FONT_WEIGHT.bold, padding: `${SPACE.xxs}px ${SPACE.md / 2}px`, borderRadius: RADIUS.sm,
                        textTransform: "uppercase", letterSpacing: ".3px",
                        color:       evt.status === "resolved" ? C.status.success : evt.status === "acknowledged" ? C.status.warning : "var(--c-sev1)",
                        background:  evt.status === "resolved" ? "var(--c-green-bg)" : evt.status === "acknowledged" ? "var(--c-sev2-bg)" : "var(--c-sev1-bg)",
                        border: `1px solid ${evt.status === "resolved" ? `${C.status.success}44` : evt.status === "acknowledged" ? `${C.status.warning}44` : `${C.error.border}44`}`,
                      }}>
                        {(evt.status ?? "open")}
                      </span>
                    </div>
                  </Link>
                );
              })
            )}
            {recent.length > 0 && (
              <Link to="/history" className="hover-bg-accent-dim" style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: SPACE.md / 2,
                padding: `${SPACE.sm + 3}px ${SPACE.xl - SPACE.xxs}px`, textAlign: "center",
                fontSize: FONT_SIZE.sm + 1, color: "var(--c-accent)", textDecoration: "none",
                borderTop: `1px solid ${C.border.muted}`, fontWeight: FONT_WEIGHT.semibold,
                transition: "background .15s",
              }}>
                View all incidents
                <ArrowRight size={12} strokeWidth={2.5} />
              </Link>
            )}
          </div>
        </Section>

        {/* ── Workload health per online target ────────────────────────── */}
        {targets.filter(t => t.status === "online").length > 0 && (
          <Section label="Workload Health">
            <div style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
              {targets.filter(t => t.status === "online").map(t => (
                <div key={t.id} style={{ display: "flex", flexDirection: "column", gap: SPACE.xxs }}>
                  <span style={{ fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.semibold, color: C.text.muted }}>{t.name}</span>
                  <HealthSummaryBar targetId={t.id} />
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Connections overview ──────────────────────────────────────── */}
        {targets.length > 0 && (
          <Section label="Connections">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: SPACE.sm + SPACE.xxs }}>
              {targets.map(t => {
                const dotColor  = t.status === "online" ? C.status.success : t.status === "offline" ? C.status.danger : C.text.muted;
                const meta = TARGET_META[t.type as keyof typeof TARGET_META];
                const tc = meta?.color ?? C.text.muted;
                const TypeIcon = meta?.icon;
                return (
                  <Link
                    key={t.id}
                    to="/dashboard"
                    className="card-interactive"
                    style={{
                      background: C.bg.card,
                      border: `1px solid ${C.border.muted}`,
                      borderRadius: RADIUS.lg + SPACE.xxs, padding: `${SPACE.md + 1}px ${SPACE.lg - 1}px`, textDecoration: "none",
                      display: "flex", alignItems: "center", gap: SPACE.sm + SPACE.xxs,
                      transition: "border-color .2s, box-shadow .2s",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{
                      width: SPACE.sm, height: SPACE.sm, borderRadius: "50%",
                      background: dotColor,
                      boxShadow: t.status === "online" ? `0 0 6px ${dotColor}` : "none",
                      flexShrink: 0,
                    }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: FONT_SIZE.md, fontWeight: FONT_WEIGHT.semibold, color: C.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                      <div style={{ fontSize: FONT_SIZE.xs, color: tc, marginTop: 1, fontWeight: FONT_WEIGHT.semibold, display: "flex", alignItems: "center", gap: SPACE.xs }}>
                        {TypeIcon && <TypeIcon size={10} />}
                        {t.type}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </Section>
        )}

      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color, icon, sparkData, warn, pulse, loading }: {
  label: string; value: string | number; sub: string;
  color: string; icon: React.ReactNode;
  sparkData?: number[];
  warn?: string; pulse?: boolean; loading?: boolean;
}) {
  return (
    <div className="card-interactive" style={{
      background: C.bg.card,
      border: `1px solid ${C.border.muted}`,
      borderRadius: RADIUS.xl,
      padding: `${SPACE.xl - SPACE.xxs}px ${SPACE.xl - SPACE.xxs}px ${SPACE.md + SPACE.xxs}px`,
      display: "flex", flexDirection: "column", gap: 0,
      position: "relative", overflow: "hidden",
      transition: "box-shadow .2s, border-color .2s",
      animation: "slideUp .3s ease-out",
    }}>
      {/* Top accent bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: SPACE.xxs, background: `linear-gradient(90deg,${color},${color}44)` }} />

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: SPACE.md + SPACE.xxs }}>
        <span style={{ fontSize: FONT_SIZE.xs, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".7px", fontWeight: FONT_WEIGHT.bold }}>{label}</span>
        <span style={{ color, opacity: 0.75 }}>{icon}</span>
      </div>

      {/* Value + sparkline row */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: SPACE.sm + SPACE.xxs }}>
        {loading ? (
          <div className="skeleton" style={{ width: 52, height: FONT_SIZE.hero, borderRadius: RADIUS.md }} />
        ) : (
          <span style={{
            fontSize: FONT_SIZE.hero, fontWeight: FONT_WEIGHT.black, color, letterSpacing: "-1.5px", lineHeight: 1,
            animation: pulse ? "pulse 2s infinite" : "none",
            textShadow: pulse ? `0 0 20px ${color}66` : "none",
          }}>
            {value}
          </span>
        )}
        {sparkData && !loading && (
          <div style={{ opacity: 0.7 }}>
            <Sparkline values={sparkData} color={color} width={76} height={30} />
          </div>
        )}
      </div>

      {/* Sub-label row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {loading ? (
          <div className="skeleton" style={{ width: 80, height: FONT_SIZE.xs }} />
        ) : (
          <span style={{ fontSize: FONT_SIZE.sm, color: C.text.muted, fontWeight: FONT_WEIGHT.medium }}>{sub}</span>
        )}
        {warn && <span style={{ fontSize: FONT_SIZE.xs, color: C.status.danger, fontWeight: FONT_WEIGHT.bold }}>{warn}</span>}
      </div>
    </div>
  );
}

function ActionCard({ to, label, desc, accent, icon }: {
  to: string; label: string; desc: string; accent: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="card-interactive"
      style={{
        background: C.bg.card,
        border: `1px solid ${C.border.muted}`,
        borderRadius: RADIUS.xl, padding: `${SPACE.xl}px ${SPACE.xl}px`,
        textDecoration: "none", color: C.text.primary,
        display: "flex", flexDirection: "column", gap: SPACE.md + SPACE.xxs,
        transition: "all .2s", cursor: "pointer",
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: RADIUS.xl,
        background: accent + "18", border: `1px solid ${accent}33`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: accent, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: FONT_SIZE.lg, fontWeight: FONT_WEIGHT.bold, color: C.text.primary, marginBottom: SPACE.md / 2, letterSpacing: "-.2px" }}>{label}</div>
        <div style={{ fontSize: FONT_SIZE.sm + 1, color: C.text.muted, lineHeight: 1.6 }}>{desc}</div>
      </div>
      <div style={{ fontSize: FONT_SIZE.sm + 1, color: accent, fontWeight: FONT_WEIGHT.bold, display: "flex", alignItems: "center", gap: SPACE.xs + 1, marginTop: "auto" }}>
        Open
        <ArrowRight size={12} strokeWidth={2.5} />
      </div>
    </Link>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: SPACE.xxl + SPACE.sm }}>
      <div style={{
        fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.black, color: C.text.muted,
        textTransform: "uppercase", letterSpacing: ".9px", marginBottom: SPACE.md + SPACE.xxs,
        display: "flex", alignItems: "center", gap: SPACE.sm,
      }}>
        <span style={{ flex: 1, height: 1, background: C.border.muted, display: "block" }} />
        {label}
        <span style={{ flex: 1, height: 1, background: C.border.muted, display: "block" }} />
      </div>
      {children}
    </div>
  );
}
