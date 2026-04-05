import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import type { Target } from "../types";

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

const TYPE_ICONS: Record<string, string> = {
  kubernetes: "K8s", docker: "Docker", aws: "AWS", gcp: "GCP",
  azure: "Azure", terraform: "TF", ssh: "SSH", local: "Local",
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
          display: "flex", alignItems: "center", gap: 9,
          padding: "9px 12px", borderRadius: 7, fontSize: 13,
          color: active ? "#e2e8f0" : "#64748b",
          background: active ? "#1e2340" : "transparent",
          borderLeft: active ? "2px solid #6366f1" : "2px solid transparent",
          textDecoration: "none", transition: "all .15s",
          fontWeight: active ? 600 : 400,
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#161b27"; }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
      >
        <span style={{ flexShrink: 0, opacity: active ? 1 : 0.6 }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {badge}
      </Link>
    );
  };

  return (
    <div style={{
      width: 230,
      background: "#0b0d14",
      borderRight: "1px solid #1e2235",
      display: "flex", flexDirection: "column",
      flexShrink: 0, height: "100vh",
    }}>

      {/* Logo */}
      <div style={{
        padding: "16px 16px 14px",
        borderBottom: "1px solid #1e2235",
        display: "flex", alignItems: "center", gap: 9,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: "linear-gradient(135deg,#6366f1,#818cf8)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-.2px" }}>
            Aziro<span style={{ color: "#6366f1" }}>Ops</span>
          </div>
          <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: ".6px" }}>
            DevOps Command Center
          </div>
        </div>
      </div>

      {/* Connections section */}
      <div style={{ padding: "12px 12px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700 }}>
          Connections
        </span>
        <span style={{ fontSize: 10, color: "#475569" }}>{targets.length}</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 4px" }}>
        {targets.length === 0 && (
          <div style={{ padding: "14px 8px", color: "#475569", fontSize: 12, textAlign: "center", lineHeight: 1.5 }}>
            No connections yet.<br />Click below to add one.
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
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                background: isActive ? "#1e2340" : isHovered ? "#161b27" : "transparent",
                border: `1px solid ${isActive ? "#6366f144" : "transparent"}`,
                marginBottom: 2, transition: "all .15s",
              }}
            >
              {/* Type badge */}
              <div style={{
                width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                background: `${typeColor}18`,
                border: `1px solid ${typeColor}33`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 8, fontWeight: 700, color: typeColor, letterSpacing: ".3px",
              }}>
                {TYPE_ICONS[t.type] ?? t.type.slice(0, 3).toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isActive ? "#e2e8f0" : "#cbd5e1" }}>
                  {t.name}
                  {t.type === "local" && (
                    <span style={{ fontSize: 8, color: "#22c55e", fontWeight: 800, marginLeft: 5, background: "#22c55e18", padding: "1px 4px", borderRadius: 3 }}>LOCAL</span>
                  )}
                </div>
                {/* Status pill */}
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: dotColor, boxShadow: t.status === "online" ? `0 0 5px ${dotColor}` : "none", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: dotColor }}>{t.status ?? "unknown"}</span>
                </div>
              </div>

              {/* Remove — only on hover */}
              <button
                onClick={e => { e.stopPropagation(); onRemove(t.id); }}
                style={{
                  background: "none", border: "none", color: "#ef4444",
                  cursor: "pointer", padding: "2px 4px", borderRadius: 3,
                  fontSize: 14, lineHeight: 1,
                  opacity: isHovered ? 1 : 0,
                  transition: "opacity .15s",
                }}
                title="Remove connection"
              >×</button>
            </div>
          );
        })}

        {/* Add connection button */}
        <button
          onClick={onAddClick}
          style={{
            width: "100%", marginTop: 6,
            padding: "9px 12px",
            background: "transparent",
            border: "1px dashed #2d3555",
            borderRadius: 8,
            color: "#6366f1",
            fontSize: 12, fontWeight: 600,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            transition: "all .15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "#6366f110"; e.currentTarget.style.borderColor = "#6366f1"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "#2d3555"; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Connection
        </button>
      </div>

      {/* Nav */}
      <div style={{ borderTop: "1px solid #1e2235", padding: "8px 8px 4px", display: "flex", flexDirection: "column", gap: 1 }}>
        {navItem("/", "Home",
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        )}
        {navItem("/dashboard", "Dashboard",
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          </svg>
        )}
        {navItem("/alerts", "Live Alerts",
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>,
          monitorActive && (
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", animation: "pulse 1.5s infinite", display: "inline-block", boxShadow: "0 0 6px #22c55e" }} />
          )
        )}
        {navItem("/history", "History",
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        )}
        {navItem("/chat", "AI Chat",
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        )}
      </div>

      {/* AI model footer */}
      {aiModel && (
        <div style={{
          padding: "8px 14px 12px",
          borderTop: "1px solid #1e2235",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "#22c55e", boxShadow: "0 0 5px #22c55e",
            flexShrink: 0, animation: "pulse 2s infinite",
          }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: ".6px" }}>AI Model</div>
            <div style={{ fontSize: 11, color: "#818cf8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }} title={aiModel}>
              {aiModel.replace("gemini/", "").replace("ollama/", "").replace("openai/", "")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
