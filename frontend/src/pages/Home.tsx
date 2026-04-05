import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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

/** Deterministic fake-trend based on a seed value for decorative sparklines */
function trendData(seed: number, len = 10, direction: "up" | "down" | "flat" = "flat"): number[] {
  const base = seed || 1;
  return Array.from({ length: len }, (_, i) => {
    const noise = Math.sin(i * 1.7 + base) * 0.3 + Math.cos(i * 0.9 + base * 0.3) * 0.2;
    const trend = direction === "up" ? i * 0.1 : direction === "down" ? -i * 0.1 : 0;
    return Math.max(0, base + noise + trend);
  });
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
    }).catch(() => {}).finally(() => setLoading(false));
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
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
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
            sparkData={trendData(targets.length, 10, targets.length > 2 ? "up" : "flat")}
            warn={offline > 0 ? `${offline} offline` : undefined}
            loading={loading}
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
                <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
                <line x1="12" y1="20" x2="12.01" y2="20"/>
              </svg>
            }
          />
          <StatCard
            label="Critical (SEV1)"
            value={loading ? "—" : criticals}
            sub="requiring action"
            color={criticals > 0 ? "#f43f5e" : "#22c55e"}
            sparkData={trendData(criticals + 1, 10, criticals > 0 ? "up" : "down")}
            pulse={criticals > 0}
            loading={loading}
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            }
          />
          <StatCard
            label="Warnings (SEV2)"
            value={loading ? "—" : warnings}
            sub="needs investigation"
            color={warnings > 0 ? "#f59e0b" : "#22c55e"}
            sparkData={trendData(warnings + 1, 10, warnings > 3 ? "up" : "flat")}
            loading={loading}
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            }
          />
          <StatCard
            label="Monitor"
            value={monitorActive ? "Active" : "Idle"}
            sub={monitorActive ? "Watching live events" : "Start to capture events"}
            color={monitorActive ? "#22c55e" : "#64748b"}
            sparkData={trendData(3, 10, monitorActive ? "up" : "flat")}
            pulse={monitorActive}
            loading={false}
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
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
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
              }
            />
            <ActionCard
              to="/dashboard"
              label="Dashboard"
              desc="Inspect pods, nodes, deployments and resource details"
              accent="#6366f1"
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                </svg>
              }
            />
            <ActionCard
              to="/chat"
              label="AI Chat"
              desc="Ask your AI assistant about infrastructure, incidents or DevOps"
              accent="#818cf8"
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
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
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#263050" strokeWidth="1.2" style={{ marginBottom: 12 }}>
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
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
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                </svg>
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
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
        </svg>
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
