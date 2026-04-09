import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Zap, Wifi, AlertTriangle, AlertCircle, Bell, LayoutGrid, MessageSquare, Clock, ArrowRight } from "lucide-react";
import type { Target, StoredEvent, TriageLevel } from "../types";
import { LEVEL_COLORS } from "../types";
import { api } from "../api/client";

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
    <div id="main" style={{ flex: 1, overflowY: "auto", background: "var(--c-bg-base)" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "36px 28px" }}>

        {/* ── Page header ───────────────────────────────────────────────── */}
        <div style={{ marginBottom: 36, animation: "slideUp .3s ease-out" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 11,
              background: "linear-gradient(135deg,#6366f1 0%,#818cf8 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 24px #6366f144, 0 4px 12px #6366f133",
              flexShrink: 0,
            }}>
              <Zap size={20} fill="white" stroke="white" />
            </div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--c-text-primary)", letterSpacing: "-.5px", lineHeight: 1.2 }}>
                AziroOps
              </h1>
              <div style={{ fontSize: 12, color: "var(--c-text-muted)", marginTop: 2, fontWeight: 500 }}>
                AI-powered DevOps command center
              </div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: online > 0 ? "#22c55e" : "#64748b",
                boxShadow: online > 0 ? "0 0 8px #22c55e88" : "none",
                animation: online > 0 ? "pulse 2s infinite" : "none",
                display: "inline-block",
              }} />
              <span style={{ fontSize: 12, color: online > 0 ? "#22c55e" : "var(--c-text-muted)", fontWeight: 600 }}>
                {online > 0 ? `${online} online` : "No connections"}
              </span>
            </div>
          </div>
        </div>

        {/* ── Stat cards ────────────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 32 }}>
          <StatCard
            label="Connections"
            value={targets.length}
            sub={online > 0 ? `${online} online` : "none online"}
            color="#6366f1"

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
            color={criticals > 0 ? "#f43f5e" : "#22c55e"}

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
            color={warnings > 0 ? "#f59e0b" : "#22c55e"}

            loading={loading}
            icon={
              <AlertCircle size={16} />
            }
          />
          <StatCard
            label="Monitor"
            value={monitorActive ? "Active" : "Idle"}
            sub={monitorActive ? "Watching live events" : "Start to capture events"}
            color={monitorActive ? "#22c55e" : "#64748b"}

            pulse={monitorActive}
            loading={false}
            icon={
              <Bell size={16} />
            }
          />
        </div>

        {/* ── Quick actions ─────────────────────────────────────────────── */}
        <Section label="Quick Actions">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
            <ActionCard
              to="/alerts"
              label="Live Alerts"
              desc="Monitor infrastructure in real-time and get notified instantly"
              accent="#f43f5e"
              icon={
                <Bell size={22} strokeWidth={1.8} />
              }
            />
            <ActionCard
              to="/dashboard"
              label="Dashboard"
              desc="Inspect pods, nodes, deployments and resource details"
              accent="#6366f1"
              icon={
                <LayoutGrid size={22} strokeWidth={1.8} />
              }
            />
            <ActionCard
              to="/chat"
              label="AI Chat"
              desc="Ask your AI assistant about infrastructure, incidents or DevOps"
              accent="#818cf8"
              icon={
                <MessageSquare size={22} strokeWidth={1.8} />
              }
            />
          </div>
        </Section>

        {/* ── Recent activity ───────────────────────────────────────────── */}
        <Section label="Recent Incidents">
          <div style={{
            background: "var(--c-bg-surface)",
            border: "1px solid var(--c-border)",
            borderRadius: 12, overflow: "hidden",
            boxShadow: "var(--shadow-md)",
          }}>
            {loading ? (
              <div style={{ padding: "20px 18px" }}>
                {[85, 60, 75, 55, 70].map((w, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <div className="skeleton" style={{ width: 36, height: 18, borderRadius: 4, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div className="skeleton" style={{ height: 13, width: `${w}%`, marginBottom: 6 }} />
                      <div className="skeleton" style={{ height: 10, width: `${w - 20}%` }} />
                    </div>
                    <div className="skeleton" style={{ width: 40, height: 10 }} />
                  </div>
                ))}
              </div>
            ) : recent.length === 0 ? (
              <div style={{ padding: "48px 18px", textAlign: "center" }}>
                <Clock size={44} stroke="#263050" strokeWidth={1.2} style={{ marginBottom: 12 }} />
                <div style={{ fontSize: 14, color: "var(--c-text-secondary)", fontWeight: 600, marginBottom: 4 }}>No incidents recorded yet</div>
                <div style={{ fontSize: 12, color: "var(--c-text-muted)" }}>Start monitoring a target to capture events.</div>
              </div>
            ) : (
              recent.map((evt, i) => {
                const c = LEVEL_COLORS[evt.level as TriageLevel];
                return (
                  <Link
                    key={evt.id}
                    to="/history"
                    style={{
                      display: "flex", alignItems: "center", gap: 14,
                      padding: "12px 18px", textDecoration: "none",
                      borderBottom: i < recent.length - 1 ? "1px solid var(--c-border)" : "none",
                      borderLeft: `3px solid ${c?.border ?? "#263050"}`,
                      transition: "background .15s",
                      cursor: "pointer",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--c-bg-raised)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <span style={{
                      fontSize: 9, fontWeight: 800, padding: "3px 7px", borderRadius: 5,
                      color: c?.text ?? "var(--c-text-primary)",
                      background: c?.bg ?? "var(--c-bg-overlay)",
                      border: `1px solid ${c?.border ?? "#263050"}`,
                      flexShrink: 0, letterSpacing: ".4px", textTransform: "uppercase",
                    }}>
                      {evt.level}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--c-text-primary)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {evt.reason} <span style={{ color: "var(--c-text-secondary)", fontWeight: 400 }}>— {evt.object}</span>
                      </div>
                      {evt.message && (
                        <div style={{ fontSize: 11, color: "var(--c-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                          {evt.message}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: "var(--c-text-faint)" }}>{relativeTime(evt.timestamp)}</span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                        textTransform: "uppercase", letterSpacing: ".3px",
                        color:       evt.status === "resolved" ? "#22c55e" : evt.status === "acknowledged" ? "#f59e0b" : "#f43f5e",
                        background:  evt.status === "resolved" ? "#052e16" : evt.status === "acknowledged" ? "#2a1a00" : "#2a0011",
                        border: `1px solid ${evt.status === "resolved" ? "#22c55e44" : evt.status === "acknowledged" ? "#f59e0b44" : "#f43f5e44"}`,
                      }}>
                        {(evt.status ?? "open")}
                      </span>
                    </div>
                  </Link>
                );
              })
            )}
            {recent.length > 0 && (
              <Link to="/history" style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                padding: "11px 18px", textAlign: "center",
                fontSize: 12, color: "var(--c-accent)", textDecoration: "none",
                borderTop: "1px solid var(--c-border)", fontWeight: 600,
                transition: "background .15s",
              }}
                onMouseEnter={e => (e.currentTarget.style.background = "#6366f10a")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                View all incidents
                <ArrowRight size={12} strokeWidth={2.5} />
              </Link>
            )}
          </div>
        </Section>

        {/* ── Connections overview ──────────────────────────────────────── */}
        {targets.length > 0 && (
          <Section label="Connections">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 10 }}>
              {targets.map(t => {
                const dotColor  = t.status === "online" ? "#22c55e" : t.status === "offline" ? "#ef4444" : "#64748b";
                const typeColor: Record<string, string> = {
                  kubernetes: "#326CE5", docker: "#2496ED", aws: "#FF9900",
                  gcp: "#4285F4", azure: "#0078D4", terraform: "#7B42BC",
                  ssh: "#22c55e", local: "#22c55e",
                };
                const tc = typeColor[t.type] ?? "#64748b";
                return (
                  <Link
                    key={t.id}
                    to="/dashboard"
                    style={{
                      background: "var(--c-bg-surface)",
                      border: "1px solid var(--c-border)",
                      borderRadius: 10, padding: "13px 15px", textDecoration: "none",
                      display: "flex", alignItems: "center", gap: 10,
                      transition: "border-color .2s, box-shadow .2s",
                      cursor: "pointer",
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = tc + "77";
                      e.currentTarget.style.boxShadow = `0 0 16px ${tc}22`;
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = "var(--c-border)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: dotColor,
                      boxShadow: t.status === "online" ? `0 0 6px ${dotColor}` : "none",
                      flexShrink: 0,
                    }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                      <div style={{ fontSize: 10, color: tc, marginTop: 1, fontWeight: 600 }}>{t.type}</div>
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
    <div style={{
      background: "var(--c-bg-surface)",
      border: "1px solid var(--c-border)",
      borderRadius: 12,
      padding: "18px 18px 14px",
      display: "flex", flexDirection: "column", gap: 0,
      position: "relative", overflow: "hidden",
      transition: "box-shadow .2s, border-color .2s",
      animation: "slideUp .3s ease-out",
    }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = color + "55";
        (e.currentTarget as HTMLElement).style.boxShadow = `0 0 20px ${color}1a`;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--c-border)";
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
    >
      {/* Top accent bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${color},${color}44)` }} />

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 10, color: "var(--c-text-muted)", textTransform: "uppercase", letterSpacing: ".7px", fontWeight: 700 }}>{label}</span>
        <span style={{ color, opacity: 0.75 }}>{icon}</span>
      </div>

      {/* Value + sparkline row */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 10 }}>
        {loading ? (
          <div className="skeleton" style={{ width: 52, height: 32, borderRadius: 6 }} />
        ) : (
          <span style={{
            fontSize: 32, fontWeight: 800, color, letterSpacing: "-1.5px", lineHeight: 1,
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
          <div className="skeleton" style={{ width: 80, height: 10 }} />
        ) : (
          <span style={{ fontSize: 11, color: "var(--c-text-muted)", fontWeight: 500 }}>{sub}</span>
        )}
        {warn && <span style={{ fontSize: 10, color: "#ef4444", fontWeight: 700 }}>{warn}</span>}
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
      style={{
        background: "var(--c-bg-surface)",
        border: "1px solid var(--c-border)",
        borderRadius: 12, padding: "20px 20px",
        textDecoration: "none", color: "var(--c-text-primary)",
        display: "flex", flexDirection: "column", gap: 14,
        transition: "all .2s", cursor: "pointer",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = accent + "88";
        e.currentTarget.style.background  = "var(--c-bg-raised)";
        e.currentTarget.style.boxShadow   = `0 0 24px ${accent}22`;
        e.currentTarget.style.transform   = "translateY(-1px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = "var(--c-border)";
        e.currentTarget.style.background  = "var(--c-bg-surface)";
        e.currentTarget.style.boxShadow   = "none";
        e.currentTarget.style.transform   = "translateY(0)";
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 11,
        background: accent + "18", border: `1px solid ${accent}33`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: accent, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-text-primary)", marginBottom: 6, letterSpacing: "-.2px" }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--c-text-muted)", lineHeight: 1.6 }}>{desc}</div>
      </div>
      <div style={{ fontSize: 12, color: accent, fontWeight: 700, display: "flex", alignItems: "center", gap: 5, marginTop: "auto" }}>
        Open
        <ArrowRight size={12} strokeWidth={2.5} />
      </div>
    </Link>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        fontSize: 10, fontWeight: 800, color: "var(--c-text-muted)",
        textTransform: "uppercase", letterSpacing: ".9px", marginBottom: 14,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ flex: 1, height: 1, background: "var(--c-border)", display: "block" }} />
        {label}
        <span style={{ flex: 1, height: 1, background: "var(--c-border)", display: "block" }} />
      </div>
      {children}
    </div>
  );
}
