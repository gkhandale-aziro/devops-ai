import type { KeyboardEvent } from "react";
import { Check } from "lucide-react";
import type { MonitorAlert } from "../types";
import { LEVEL_COLORS, LEVEL_LABELS } from "../types";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT } from "../utils/theme";

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
        background:   isCrit ? "var(--c-alert-sev1-bg)" : isWarn ? "var(--c-alert-sev2-bg)" : "var(--c-alert-sev3-bg)",
        border:       `1px solid ${c.border}44`,
        borderLeft:   `3px solid ${c.border}`,
        borderRadius: RADIUS.lg,
        padding:      isCrit ? `${SPACE.md}px ${SPACE.lg}px` : `${SPACE.md}px ${SPACE.md}px`,
        cursor:       onClick ? "pointer" : "default",
        userSelect:   "none",
        transition:   "background .12s, border-color .12s",
        animation:    "fadeIn .2s ease-out",
      }}
      className={onClick ? "card-interactive" : undefined}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm, marginBottom: SPACE.sm }}>
        {/* Severity badge */}
        <span style={{
          fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.black, padding: `${SPACE.xxs}px ${SPACE.sm}px`, borderRadius: RADIUS.sm,
          color: c.text, background: c.bg,
          border: `1px solid ${c.border}`,
          letterSpacing: ".4px", flexShrink: 0,
        }}>
          {alert.level}
        </span>
        <span style={{ fontSize: FONT_SIZE.xs, color: C.text.faint, flexShrink: 0, textTransform: "uppercase", letterSpacing: ".3px" }}>
          {LEVEL_LABELS[alert.level]}
        </span>

        <span style={{ flex: 1 }} />

        {/* Time */}
        <span style={{ fontSize: FONT_SIZE.xs, color: C.text.faint, flexShrink: 0 }}>{alert.ts}</span>

        {/* AI hint */}
        {onClick && (
          <span style={{ fontSize: FONT_SIZE.xs, color: c.text, opacity: 0.7, flexShrink: 0, display: "flex", alignItems: "center", gap: SPACE.xs }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            AI
          </span>
        )}
      </div>

      {/* Reason + object */}
      <div style={{ display: "flex", alignItems: "baseline", gap: SPACE.sm, marginBottom: isCrit ? SPACE.sm : SPACE.xs }}>
        <span style={{ fontSize: isCrit ? FONT_SIZE.lg : FONT_SIZE.md, fontWeight: FONT_WEIGHT.bold, color: c.text }}>{alert.reason}</span>
        <span style={{ fontSize: FONT_SIZE.sm, color: C.text.muted }}>on</span>
        <span style={{ fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold, color: C.text.secondary }}>{alert.object}</span>
        {alert.namespace && (
          <span style={{ fontSize: FONT_SIZE.xs, color: C.text.faint }}>/ {alert.namespace}</span>
        )}
      </div>

      {/* Message — 2 lines for SEV1, 1 line for others */}
      {alert.message && (
        <div style={{
          fontSize: FONT_SIZE.sm, color: C.text.muted, lineHeight: 1.5,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: isCrit ? 2 : 1,
          WebkitBoxOrient: "vertical",
        }}>
          {alert.message}
        </div>
      )}

      {/* Source + ack */}
      <div style={{ marginTop: SPACE.xs, fontSize: FONT_SIZE.xs, color: C.text.dim, display: "flex", alignItems: "center", gap: SPACE.xs }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M2 12h3m14 0h3M12 2v3m0 14v3"/></svg>
        {alert.source}
        <span style={{ flex: 1 }} />
        {onAck && !alert.acknowledged && (
          <button
            onClick={e => { e.stopPropagation(); onAck(); }}
            aria-label="Acknowledge alert"
            className="hover-opacity-full"
            style={{
              display: "flex", alignItems: "center", gap: SPACE.xs,
              padding: `${SPACE.xxs}px ${SPACE.sm}px`, borderRadius: RADIUS.sm, fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.semibold,
              background: "transparent", border: `1px solid ${c.border}66`,
              color: c.text, cursor: "pointer", opacity: 0.8,
              transition: "opacity .15s",
            }}
          >
            <Check size={10} /> Ack
          </button>
        )}
        {alert.acknowledged && (
          <span style={{ display: "flex", alignItems: "center", gap: SPACE.xs, fontSize: FONT_SIZE.xs, color: C.status.success, opacity: 0.7 }}>
            <Check size={10} /> Acknowledged
          </span>
        )}
      </div>
    </div>
  );
}
