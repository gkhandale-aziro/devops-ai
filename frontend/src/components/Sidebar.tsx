import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import type { Target } from "../types";
import { ThemeSwitcher } from "./ThemeContext";

interface Props {
  targets:       Target[];
  activeId:      string | null;
  onSelect:      (t: Target) => void;
  onRemove:      (id: string) => void;
  onAddClick:    () => void;
  monitorActive: boolean;
  aiModel:       string;
}

const TYPE_COLORS: Record<string, string> = {
  kubernetes: "#326CE5", ssh: "#22c55e", local: "#22c55e",
  docker: "#2496ED", aws: "#FF9900", gcp: "#4285F4",
  azure: "#0078D4", terraform: "#7B42BC",
};

// Proper abbreviations — legible at small sizes
const TYPE_ICONS: Record<string, string> = {
  kubernetes: "K8S", docker: "DOC", aws: "AWS", gcp: "GCP",
  azure: "AZ", terraform: "TF", ssh: "SSH", local: "LCL",
};

export function Sidebar({ targets, activeId, onSelect, onRemove, onAddClick, monitorActive, aiModel }: Props) {
  const loc = useLocation();
  const nav = useNavigate();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const navItem = (to: string, label: string, icon: ReactNode, badge?: ReactNode): ReactNode => {
    const active = loc.pathname === to;
    return (
      <Link
        to={to}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "9px 12px", borderRadius: 8, fontSize: 13,
          color: active ? "var(--c-text-primary,#f1f5f9)" : "var(--c-text-muted,#64748b)",
          background: active ? "var(--c-accent-dim,#6366f122)" : "transparent",
          borderLeft: active ? "2px solid var(--c-accent,#6366f1)" : "2px solid transparent",
          textDecoration: "none", transition: "all .15s",
          fontWeight: active ? 600 : 400,
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--c-bg-raised,#0f1629)"; }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
      >
        <span style={{ flexShrink: 0, color: active ? "var(--c-accent-hover,#818cf8)" : "var(--c-text-muted,#64748b)", transition: "color .15s" }}>
          {icon}
        </span>
        <span style={{ flex: 1 }}>{label}</span>
        {badge}
      </Link>
    );
  };

  const onlineCount = targets.filter(t => t.status === "online").length;

  return (
    <div style={{
      width: 236,
      background: "var(--c-bg-surface,#0a0f1e)",
      borderRight: "1px solid var(--c-border,#1a2235)",
      boxShadow: "2px 0 12px #00000033",
      display: "flex", flexDirection: "column",
      flexShrink: 0, height: "100vh",
    }}>

      {/* ── Logo ───────────────────────────────────────────────────────────── */}
      <div style={{
        padding: "18px 16px 16px",
        borderBottom: "1px solid var(--c-border,#1a2235)",
        display: "flex", alignItems: "center", gap: 11,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9,
          background: "linear-gradient(135deg,#6366f1 0%,#818cf8 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
          boxShadow: "0 0 16px #6366f144, 0 2px 8px #6366f133",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
        </div>
        <div>
          {/* P2: Primary brand name larger + bolder */}
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-text-primary,#f1f5f9)", letterSpacing: "-.3px", lineHeight: 1.2 }}>
            Aziro<span style={{ color: "var(--c-accent,#6366f1)" }}>Ops</span>
          </div>
          {/* P2: Subtitle at 10px min, slightly more visible */}
          <div style={{ fontSize: 10, color: "var(--c-text-faint,#475569)", textTransform: "uppercase", letterSpacing: ".7px", marginTop: 2, fontWeight: 500 }}>
            DevOps AI Platform
          </div>
        </div>
      </div>

      {/* ── Connections header ─────────────────────────────────────────────── */}
      <div style={{ padding: "16px 16px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: "var(--c-text-faint,#475569)", textTransform: "uppercase", letterSpacing: ".9px", fontWeight: 700 }}>
          Connections
        </span>
        {/* P7: Count as a colored pill, not raw grey text */}
        {targets.length > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700,
            background: onlineCount > 0 ? "#22c55e18" : "var(--c-bg-overlay,#182035)",
            color: onlineCount > 0 ? "#22c55e" : "var(--c-text-faint,#475569)",
            border: `1px solid ${onlineCount > 0 ? "#22c55e33" : "var(--c-border,#1a2235)"}`,
            borderRadius: 5, padding: "1px 7px",
          }}>
            {onlineCount}/{targets.length}
          </span>
        )}
      </div>

      {/* ── Connection list ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>

        {/* P1 + Pattern: Empty state with icon, not just plain text */}
        {targets.length === 0 && (
          <div style={{ padding: "24px 12px", textAlign: "center" }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: "var(--c-bg-overlay,#182035)",
              border: "1px solid var(--c-border,#1a2235)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 10px",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--c-text-faint,#475569)" strokeWidth="1.5">
                <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
                <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
                <line x1="12" y1="20" x2="12.01" y2="20"/>
              </svg>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text-secondary,#94a3b8)", marginBottom: 4 }}>No connections yet</div>
            <div style={{ fontSize: 11, color: "var(--c-text-faint,#475569)", lineHeight: 1.5 }}>Add a cluster or server below to get started</div>
          </div>
        )}

        {targets.map(t => {
          const isActive  = t.id === activeId;
          const isHovered = t.id === hoveredId;
          const dotColor  = t.status === "online" ? "#22c55e" : t.status === "offline" ? "#ef4444" : "#64748b";
          const typeColor = TYPE_COLORS[t.type] ?? "#64748b";

          return (
            <div
              key={t.id}
              onClick={() => { onSelect(t); nav("/dashboard"); }}
              onMouseEnter={() => setHoveredId(t.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 10px", borderRadius: 9, cursor: "pointer",
                marginBottom: 3, transition: "all .15s",
                background: isActive
                  ? "var(--c-accent-dim,#6366f122)"
                  : isHovered ? "var(--c-bg-raised,#0f1629)" : "transparent",
                border: `1px solid ${isActive ? "var(--c-accent,#6366f1)33" : "transparent"}`,
                /* P4: active item gets a subtle lift shadow */
                boxShadow: isActive ? "0 2px 8px #6366f122" : "none",
              }}
            >
              {/* P6: Type badge — 9px text (was 8px), stronger weight */}
              <div style={{
                width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                background: `${typeColor}18`,
                border: `1px solid ${typeColor}33`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, fontWeight: 800, color: typeColor, letterSpacing: ".4px",
              }}>
                {TYPE_ICONS[t.type] ?? t.type.slice(0, 3).toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* P2: Name is primary — bolder */}
                <div style={{
                  fontSize: 13, fontWeight: isActive ? 700 : 500,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: isActive ? "var(--c-text-primary,#f1f5f9)" : "var(--c-text-secondary,#94a3b8)",
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  {t.name}
                  {/* P7: LOCAL badge at 9px min (was 8px) */}
                  {t.type === "local" && (
                    <span style={{ fontSize: 9, color: "#22c55e", fontWeight: 800, background: "#22c55e18", border: "1px solid #22c55e33", padding: "1px 5px", borderRadius: 4, letterSpacing: ".3px", flexShrink: 0 }}>
                      LOCAL
                    </span>
                  )}
                </div>
                {/* P2: Status — tertiary color, smaller */}
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: "50%", background: dotColor,
                    boxShadow: t.status === "online" ? `0 0 5px ${dotColor}` : "none",
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 10, color: dotColor, fontWeight: 600 }}>{t.status ?? "unknown"}</span>
                </div>
              </div>

              {/* Remove — SVG, hover only */}
              <button
                onClick={e => { e.stopPropagation(); onRemove(t.id); }}
                aria-label="Remove connection"
                style={{
                  background: "none", border: "none",
                  color: "var(--c-text-faint,#475569)",
                  cursor: "pointer", padding: "4px", borderRadius: 5,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: isHovered ? 1 : 0,
                  transition: "opacity .15s, color .15s",
                  flexShrink: 0,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                onMouseLeave={e => (e.currentTarget.style.color = "var(--c-text-faint,#475569)")}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          );
        })}

        {/* Add connection button — solid subtle border (not dashed) */}
        <button
          onClick={onAddClick}
          style={{
            width: "100%", marginTop: targets.length > 0 ? 6 : 4,
            padding: "10px 12px",
            background: "transparent",
            border: "1px solid var(--c-border-strong,#263050)",
            borderRadius: 9,
            color: "var(--c-accent,#6366f1)",
            fontSize: 12, fontWeight: 600,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            transition: "all .15s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "var(--c-accent-dim,#6366f118)";
            e.currentTarget.style.borderColor = "var(--c-accent,#6366f1)";
            e.currentTarget.style.boxShadow  = "0 0 12px #6366f122";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "var(--c-border-strong,#263050)";
            e.currentTarget.style.boxShadow  = "none";
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Connection
        </button>
      </div>

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <div style={{ borderTop: "1px solid var(--c-border,#1a2235)", padding: "10px 8px 6px", display: "flex", flexDirection: "column", gap: 2 }}>
        {navItem("/", "Home",
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        )}
        {navItem("/dashboard", "Dashboard",
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          </svg>
        )}
        {navItem("/alerts", "Live Alerts",
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>,
          monitorActive && (
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: "#22c55e", animation: "pulse 1.5s infinite",
              display: "inline-block", boxShadow: "0 0 6px #22c55e",
              flexShrink: 0,
            }} />
          )
        )}
        {navItem("/history", "History",
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        )}
        {navItem("/chat", "AI Chat",
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        )}
      </div>

      {/* ── Footer — AI model + theme ─────────────────────────────────────── */}
      {/* P5: Consolidated into one footer block, not three separate borders */}
      <div style={{
        borderTop: "1px solid var(--c-border,#1a2235)",
        padding: "10px 14px 12px",
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        {/* AI model row */}
        {aiModel && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: "#22c55e", boxShadow: "0 0 6px #22c55e88",
              flexShrink: 0, animation: "pulse 2s infinite",
            }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              {/* P2: Label 10px (was 9), bolder */}
              <div style={{ fontSize: 10, color: "var(--c-text-faint,#475569)", textTransform: "uppercase", letterSpacing: ".6px", fontWeight: 600, marginBottom: 1 }}>AI Model</div>
              <div style={{
                fontSize: 11, fontWeight: 600,
                color: "var(--c-accent-hover,#818cf8)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }} title={aiModel}>
                {aiModel.replace("gemini/", "").replace("ollama/", "").replace("openai/", "")}
              </div>
            </div>
          </div>
        )}
        {/* Theme switcher */}
        <ThemeSwitcher />
        {/* Restore dismissed tips */}
        <button
          onClick={() => {
            let cleared = 0;
            for (let i = localStorage.length - 1; i >= 0; i--) {
              const k = localStorage.key(i);
              if (k?.startsWith("hint-")) { localStorage.removeItem(k); cleared++; }
            }
            alert(cleared > 0 ? `Restored ${cleared} tip${cleared === 1 ? "" : "s"} — refresh to see them again.` : "No dismissed tips to restore.");
          }}
          title="Restore dismissed contextual hints"
          style={{
            background: "transparent", border: "1px solid var(--c-border,#1a2235)",
            color: "var(--c-text-muted,#64748b)", borderRadius: 6,
            padding: "6px 10px", fontSize: 10, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
            textTransform: "uppercase", letterSpacing: ".4px", fontWeight: 600,
          }}
        >
          <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/>
          </svg>
          Restore tips
        </button>
      </div>
    </div>
  );
}
