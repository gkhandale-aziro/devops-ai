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
  kubernetes: "#326CE5", ssh: "#56d364", local: "#56d364",
  docker: "#2496ED", aws: "#FF9900", gcp: "#4285F4",
  azure: "#0078D4", terraform: "#7B42BC",
};

export function Sidebar({ targets, activeId, onSelect, onRemove, onAddClick, monitorActive, aiModel }: Props) {
  const loc = useLocation();
  const nav = useNavigate();

  const navItem = (to: string, label: string, icon: ReactNode): ReactNode => {
    const active = loc.pathname === to;
    return (
      <Link
        to={to}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 10px", borderRadius: 6, fontSize: 13,
          color: active ? "#e2e8f0" : "#64748b",
          background: active ? "#1a1d27" : "transparent",
          textDecoration: "none", transition: "all .15s",
        }}
      >
        {icon} {label}
      </Link>
    );
  };

  return (
    <div style={{
      width: 220, background: "#0d1117", borderRight: "1px solid #2d3148",
      display: "flex", flexDirection: "column", flexShrink: 0, height: "100vh",
    }}>
      {/* logo */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #2d3148", display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#7c8cf8"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        <span style={{ color: "#7c8cf8" }}>Aziro</span> Ops
      </div>

      {/* connections */}
      <div style={{ padding: "10px 14px 4px", fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 600 }}>
        Connections
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 6px" }}>
        {targets.length === 0 && (
          <div style={{ padding: "12px 8px", color: "#64748b", fontSize: 12 }}>No targets yet</div>
        )}
        {targets.map(t => {
          const dotColor = t.status === "online" ? "#22c55e" : t.status === "offline" ? "#ef4444" : "#64748b";
          const isActive = t.id === activeId;
          return (
            <div
              key={t.id}
              onClick={() => { onSelect(t); nav("/dashboard"); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 6, cursor: "pointer",
                background: isActive ? "#1a2040" : "transparent",
                marginBottom: 2, transition: "background .15s",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0, display: "inline-block", boxShadow: t.status === "online" ? `0 0 4px ${dotColor}` : "none" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.name}
                  {t.type === "local" && <span style={{ fontSize: 9, color: "#22c55e", fontWeight: 700, marginLeft: 5 }}>THIS</span>}
                </div>
                <span style={{ fontSize: 10, color: TYPE_COLORS[t.type] ?? "#64748b", background: "#1a1d27", padding: "1px 5px", borderRadius: 3 }}>
                  {t.type}
                </span>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onRemove(t.id); }}
                style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: "2px 4px", borderRadius: 3, fontSize: 12 }}
              >✕</button>
            </div>
          );
        })}
      </div>

      <div
        onClick={onAddClick}
        style={{ margin: "6px 8px", padding: 8, background: "#1a1d27", border: "1px dashed #2d3148", borderRadius: 6, textAlign: "center", fontSize: 12, color: "#64748b", cursor: "pointer" }}
      >
        + Add Connection
      </div>

      {/* nav */}
      <div style={{ borderTop: "1px solid #2d3148", padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
        {navItem("/", "Home",
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        )}
        {navItem("/dashboard", "Dashboard",
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        )}
        {navItem("/alerts", "Live Alerts",
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            {monitorActive && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", animation: "pulse 1.5s infinite", display: "inline-block" }} />}
          </span>
        )}
        {navItem("/history", "History",
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        )}
        {navItem("/chat", "AI Chat",
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        )}
      </div>

      {aiModel && (
        <div style={{ padding: "6px 12px 10px", borderTop: "1px solid #2d3148" }}>
          <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 3 }}>AI Model</div>
          <div style={{ fontSize: 10, color: "#7c8cf8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={aiModel}>
            {aiModel.replace("gemini/", "").replace("ollama/", "")}
          </div>
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );
}
