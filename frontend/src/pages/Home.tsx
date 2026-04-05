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
    <div style={{ flex: 1, overflowY: "auto", background: "var(--c-bg-base)" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 28px" }}>

        {/* ── Page header ───────────────────────────────────────────────── */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "linear-gradient(135deg,#6366f1,#818cf8)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
            </div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-.3px" }}>
                AziroOps
              </h1>
              <div style={{ fontSize: 12, color: "#64748b" }}>AI-powered DevOps command center</div>
            </div>
          </div>
        </div>

        {/* ── Stat cards ────────────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 28 }}>
          <StatCard
            label="Connections"
            value={targets.length}
            sub={online > 0 ? `${online} online` : "none online"}
            color="#6366f1"
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>}
            warn={offline > 0 ? `${offline} offline` : undefined}
          />
          <StatCard
            label="Critical (SEV1)"
            value={criticals}
            sub="requiring action"
            color={criticals > 0 ? "#f43f5e" : "#22c55e"}
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
            pulse={criticals > 0}
          />
          <StatCard
            label="Warnings (SEV2)"
            value={warnings}
            sub="needs investigation"
            color={warnings > 0 ? "#f59e0b" : "#22c55e"}
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
          />
          <StatCard
            label="Monitoring"
            value={monitorActive ? "Active" : "Idle"}
            sub={monitorActive ? "Watching for events" : "Start to capture events"}
            color={monitorActive ? "#22c55e" : "#64748b"}
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>}
            pulse={monitorActive}
          />
        </div>

        {/* ── Quick actions ─────────────────────────────────────────────── */}
        <Section label="Quick Actions">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <ActionCard
              to="/alerts"
              label="Live Alerts"
              desc="Monitor infrastructure in real-time and get notified instantly"
              accent="#f43f5e"
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>}
            />
            <ActionCard
              to="/dashboard"
              label="Dashboard"
              desc="Inspect pods, nodes, deployments and resource details"
              accent="#6366f1"
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>}
            />
            <ActionCard
              to="/chat"
              label="AI Chat"
              desc="Ask your AI assistant about infrastructure, incidents or DevOps"
              accent="#818cf8"
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
            />
          </div>
        </Section>

        {/* ── Recent activity ───────────────────────────────────────────── */}
        <Section label="Recent Incidents">
          <div style={{ background: "#0f1219", border: "1px solid #1e2235", borderRadius: 10, overflow: "hidden" }}>
            {loading ? (
              <div style={{ padding: "28px 18px", textAlign: "center" }}>
                {[180, 120, 220, 160, 200].map((w, i) => (
                  <div key={i} style={{ height: 13, width: w, background: "#1e2235", borderRadius: 4, margin: "0 auto 10px", animation: "shimmer 1.4s infinite" }} />
                ))}
              </div>
            ) : recent.length === 0 ? (
              <div style={{ padding: "40px 18px", textAlign: "center", color: "#475569" }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2d3555" strokeWidth="1.2" style={{ marginBottom: 10 }}>
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <div style={{ fontSize: 13 }}>No incidents recorded yet.</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Start monitoring a target to capture events.</div>
              </div>
            ) : (
              recent.map((evt, i) => {
                const c = LEVEL_COLORS[evt.level as TriageLevel];
                return (
                  <Link
                    key={evt.id}
                    to="/history"
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "11px 16px", textDecoration: "none",
                      borderBottom: i < recent.length - 1 ? "1px solid #1e2235" : "none",
                      borderLeft: `3px solid ${c?.border ?? "#2d3555"}`,
                      transition: "background .12s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#161b27")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Severity badge */}
                    <span style={{
                      fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4,
                      color: c?.text ?? "#e2e8f0",
                      background: c?.bg ?? "#1e2235",
                      border: `1px solid ${c?.border ?? "#2d3555"}`,
                      flexShrink: 0, letterSpacing: ".3px",
                    }}>
                      {evt.level}
                    </span>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "#cbd5e1", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {evt.reason} — <span style={{ color: "#94a3b8", fontWeight: 400 }}>{evt.object}</span>
                      </div>
                      {evt.message && (
                        <div style={{ fontSize: 11, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                          {evt.message}
                        </div>
                      )}
                    </div>

                    {/* Status + time */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: "#475569" }}>{relativeTime(evt.timestamp)}</span>
                      <span style={{
                        fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 3,
                        color: evt.status === "resolved" ? "#22c55e" : evt.status === "acknowledged" ? "#f59e0b" : "#f43f5e",
                        background: evt.status === "resolved" ? "#0a2a1a" : evt.status === "acknowledged" ? "#2a1a00" : "#2a0011",
                      }}>
                        {(evt.status ?? "open").toUpperCase()}
                      </span>
                    </div>
                  </Link>
                );
              })
            )}
            {recent.length > 0 && (
              <Link to="/history" style={{
                display: "block", padding: "10px 16px", textAlign: "center",
                fontSize: 12, color: "#6366f1", textDecoration: "none",
                borderTop: "1px solid #1e2235", fontWeight: 500,
              }}
                onMouseEnter={e => (e.currentTarget.style.background = "#6366f108")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                View all incidents →
              </Link>
            )}
          </div>
        </Section>

        {/* ── Connections overview ──────────────────────────────────────── */}
        {targets.length > 0 && (
          <Section label="Connections">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10 }}>
              {targets.map(t => {
                const dotColor = t.status === "online" ? "#22c55e" : t.status === "offline" ? "#ef4444" : "#64748b";
                const typeColor = { kubernetes: "#326CE5", docker: "#2496ED", aws: "#FF9900", gcp: "#4285F4", azure: "#0078D4", terraform: "#7B42BC", ssh: "#22c55e", local: "#22c55e" }[t.type] ?? "#64748b";
                return (
                  <Link
                    key={t.id}
                    to="/dashboard"
                    style={{
                      background: "#0f1219", border: "1px solid #1e2235",
                      borderRadius: 8, padding: "12px 14px", textDecoration: "none",
                      display: "flex", alignItems: "center", gap: 10, transition: "border-color .15s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = typeColor + "66")}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = "#1e2235")}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, boxShadow: t.status === "online" ? `0 0 5px ${dotColor}` : "none", flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                      <div style={{ fontSize: 10, color: typeColor, marginTop: 1 }}>{t.type}</div>
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

function StatCard({ label, value, sub, color, icon, warn, pulse }: {
  label: string; value: string | number; sub: string;
  color: string; icon: React.ReactNode;
  warn?: string; pulse?: boolean;
}) {
  return (
    <div style={{
      background: "#0f1219", border: "1px solid #1e2235", borderRadius: 10,
      padding: "16px 16px", display: "flex", flexDirection: "column", gap: 10,
      position: "relative", overflow: "hidden",
    }}>
      {/* top bar accent */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: color, opacity: 0.6 }} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700 }}>{label}</span>
        <span style={{ color, opacity: 0.7 }}>{icon}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <span style={{
          fontSize: 30, fontWeight: 800, color, letterSpacing: "-1px", lineHeight: 1,
          animation: pulse ? "pulse 2s infinite" : "none",
        }}>{value}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "#475569" }}>{sub}</span>
        {warn && <span style={{ fontSize: 10, color: "#ef4444", fontWeight: 600 }}>{warn}</span>}
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
        background: "#0f1219", border: "1px solid #1e2235", borderRadius: 10,
        padding: "18px 18px", textDecoration: "none", color: "#e2e8f0",
        display: "flex", flexDirection: "column", gap: 12, transition: "all .15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = accent + "88"; e.currentTarget.style.background = "#161b27"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e2235"; e.currentTarget.style.background = "#0f1219"; }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: accent + "18", border: `1px solid ${accent}33`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: accent,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{desc}</div>
      </div>
      <div style={{ fontSize: 12, color: accent, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
        Open <span>→</span>
      </div>
    </Link>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".7px", marginBottom: 12 }}>
        {label}
      </div>
      {children}
    </div>
  );
}
