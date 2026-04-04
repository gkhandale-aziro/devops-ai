import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Target, StoredEvent } from "../types";
import { api } from "../api/client";

interface Props {
  targets: Target[];
  monitorActive: boolean;
}

export function Home({ targets, monitorActive }: Props) {
  const [alertCount, setAlertCount] = useState(0);
  const [recent, setRecent]         = useState<StoredEvent[]>([]);

  useEffect(() => {
    api.events.list({ limit: 6 }).then(evts => {
      setRecent(evts);
      setAlertCount(evts.filter(e => e.level === "SEV1" || e.level === "SEV2").length);
    }).catch(() => {});
  }, []);

  const online = targets.filter(t => t.status === "online").length;

  const statCards: { label: string; value: string | number; color: string; sub: string }[] = [
    { label: "Connections",    value: targets.length, color: "#7c8cf8", sub: `${online} online` },
    { label: "Active Servers", value: online,         color: "#22c55e", sub: `of ${targets.length} total` },
    { label: "Live Alerts",    value: alertCount,     color: alertCount > 0 ? "#f59e0b" : "#22c55e", sub: monitorActive ? "Monitor active" : "Monitor idle" },
  ];

  const actions: { label: string; to: string; icon: string; desc: string; accent: string }[] = [
    { label: "Live Alerts",  to: "/alerts",  icon: "🔔", desc: "Monitor infrastructure in real-time",  accent: "#f59e0b" },
    { label: "AI Chat",      to: "/chat",    icon: "💬", desc: "Ask the AI assistant anything",         accent: "#7c8cf8" },
    { label: "History",      to: "/history", icon: "📋", desc: "Browse past incidents and events",      accent: "#06b6d4" },
  ];

  const levelColor: Record<string, string> = { SEV1: "#f43f5e", SEV2: "#f59e0b", SEV3: "#06b6d4" };

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#0d1117" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "40px 24px" }}>

        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="#7c8cf8"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.5px" }}>
              <span style={{ color: "#7c8cf8" }}>Aziro</span> Ops
            </span>
          </div>
          <div style={{ fontSize: 15, color: "#94a3b8", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
            AI-powered DevOps command center. Monitor, diagnose, and resolve infrastructure issues — all from one place.
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
          {statCards.map(c => (
            <div key={c.label} style={{
              background: "#141820", border: "1px solid #1e2235", borderRadius: 10,
              padding: "20px 18px", display: "flex", flexDirection: "column", gap: 6,
            }}>
              <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 600 }}>{c.label}</span>
              <span style={{ fontSize: 32, fontWeight: 700, color: c.color }}>{c.value}</span>
              <span style={{ fontSize: 12, color: "#475569" }}>{c.sub}</span>
            </div>
          ))}
        </div>

        {/* Quick actions */}
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 13, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 12, fontWeight: 600 }}>Quick Actions</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {actions.map(a => (
              <Link
                key={a.to}
                to={a.to}
                style={{
                  background: "#141820", border: "1px solid #1e2235", borderRadius: 10,
                  padding: "16px 18px", textDecoration: "none", color: "#e2e8f0",
                  display: "flex", flexDirection: "column", gap: 8, transition: "border-color .15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = a.accent)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "#1e2235")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{a.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: a.accent }}>{a.label}</span>
                </div>
                <span style={{ fontSize: 12, color: "#64748b" }}>{a.desc}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div>
          <h3 style={{ fontSize: 13, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 12, fontWeight: 600 }}>Recent Activity</h3>
          <div style={{ background: "#141820", border: "1px solid #1e2235", borderRadius: 10, overflow: "hidden" }}>
            {recent.length === 0 ? (
              <div style={{ padding: "24px 18px", textAlign: "center", color: "#475569", fontSize: 13 }}>
                No recent events. Start monitoring to see activity here.
              </div>
            ) : (
              recent.map((evt, i) => (
                <div
                  key={evt.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 18px", fontSize: 13,
                    borderBottom: i < recent.length - 1 ? "1px solid #1e2235" : "none",
                  }}
                >
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                    color: levelColor[evt.level] ?? "#64748b",
                    background: `${levelColor[evt.level] ?? "#64748b"}18`,
                  }}>
                    {evt.level}
                  </span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#cbd5e1" }}>
                    {evt.object} — {evt.reason}
                  </span>
                  <span style={{ fontSize: 11, color: "#475569", flexShrink: 0 }}>
                    {new Date(evt.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
