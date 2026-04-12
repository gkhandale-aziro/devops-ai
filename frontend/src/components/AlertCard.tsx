import type { KeyboardEvent } from "react";
import { Check } from "lucide-react";
import type { MonitorAlert } from "../types";
import { LEVEL_COLORS, LEVEL_LABELS } from "../types";

interface Props {
  alert: MonitorAlert & { ts: string; acknowledged?: boolean };
  onClick?: () => void;
  onAck?: () => void;
}

export function AlertCard({ alert, onClick, onAck }: Props) {
  const c       = LEVEL_COLORS[alert.level];
  const isCrit  = alert.level === "SEV1";
  const isWarn  = alert.level === "SEV2";

  const interactiveProps = onClick ? {
    role: "button",
    tabIndex: 0,
    "aria-label": `${alert.level} alert: ${alert.reason} on ${alert.object}. Click to open AI analysis.`,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    },
  } : {};

  return (
    <div
      onClick={onClick}
      {...interactiveProps}
      style={{
        background:   isCrit ? "#1a0a0e" : isWarn ? "#17110a" : "#0e141d",
        border:       `1px solid ${c.border}44`,
        borderLeft:   `3px solid ${c.border}`,
        borderRadius: 8,
        padding:      isCrit ? "12px 14px" : "10px 12px",
        cursor:       onClick ? "pointer" : "default",
        userSelect:   "none",
        transition:   "background .12s, border-color .12s",
        animation:    "fadeIn .2s ease-out",
      }}
      onMouseEnter={e => onClick && (e.currentTarget.style.borderColor = c.border + "88")}
      onMouseLeave={e => onClick && (e.currentTarget.style.borderColor = c.border + "44")}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {/* Severity badge */}
        <span style={{
          fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 4,
          color: c.text, background: c.bg,
          border: `1px solid ${c.border}`,
          letterSpacing: ".4px", flexShrink: 0,
        }}>
          {alert.level}
        </span>
        <span style={{ fontSize: 9, color: "#475569", flexShrink: 0, textTransform: "uppercase", letterSpacing: ".3px" }}>
          {LEVEL_LABELS[alert.level]}
        </span>

        <span style={{ flex: 1 }} />

        {/* Time */}
        <span style={{ fontSize: 10, color: "#475569", flexShrink: 0 }}>{alert.ts}</span>

        {/* AI hint */}
        {onClick && (
          <span style={{ fontSize: 10, color: c.text, opacity: 0.7, flexShrink: 0, display: "flex", alignItems: "center", gap: 3 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            AI
          </span>
        )}
      </div>

      {/* Reason + object */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: isCrit ? 6 : 4 }}>
        <span style={{ fontSize: isCrit ? 14 : 13, fontWeight: 700, color: c.text }}>{alert.reason}</span>
        <span style={{ fontSize: 11, color: "var(--c-text-muted)" }}>on</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text-secondary)" }}>{alert.object}</span>
        {alert.namespace && (
          <span style={{ fontSize: 10, color: "#475569" }}>/ {alert.namespace}</span>
        )}
      </div>

      {/* Message — 2 lines for SEV1, 1 line for others */}
      {alert.message && (
        <div style={{
          fontSize: 11, color: "var(--c-text-muted)", lineHeight: 1.5,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: isCrit ? 2 : 1,
          WebkitBoxOrient: "vertical",
        }}>
          {alert.message}
        </div>
      )}

      {/* Source + ack */}
      <div style={{ marginTop: 5, fontSize: 10, color: "#374151", display: "flex", alignItems: "center", gap: 4 }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M2 12h3m14 0h3M12 2v3m0 14v3"/></svg>
        {alert.source}
        <span style={{ flex: 1 }} />
        {onAck && !alert.acknowledged && (
          <button
            onClick={e => { e.stopPropagation(); onAck(); }}
            aria-label="Acknowledge alert"
            style={{
              display: "flex", alignItems: "center", gap: 3,
              padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
              background: "transparent", border: `1px solid ${c.border}66`,
              color: c.text, cursor: "pointer", opacity: 0.8,
              transition: "opacity .15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "0.8")}
          >
            <Check size={10} /> Ack
          </button>
        )}
        {alert.acknowledged && (
          <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#22c55e", opacity: 0.7 }}>
            <Check size={10} /> Acknowledged
          </span>
        )}
      </div>
    </div>
  );
}
