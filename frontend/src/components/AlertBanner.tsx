/**
 * AlertBanner — route-persistent banner that appears when a SEV1/SEV2
 * alert arrives while the user is NOT on the /alerts page. Clicking the
 * banner navigates to /alerts; the X button dismisses it until the next
 * alert arrives.
 */
import { useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import type { SSEEvent, MonitorAlert } from "../types";
import { LEVEL_COLORS, LEVEL_LABELS } from "../types";
import { useMonitorSSE } from "../hooks/useSSE";

interface Props {
  monitorActive: boolean;
}

export function AlertBanner({ monitorActive }: Props) {
  const [alert, setAlert] = useState<MonitorAlert | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();

  const onEvent = useCallback((e: SSEEvent) => {
    if (e.type !== "monitor_alert") return;
    const a = e as MonitorAlert;
    if (a.level === "SEV1" || a.level === "SEV2") {
      setAlert(a);
      setDismissed(false);
    }
  }, []);

  useMonitorSSE(monitorActive, onEvent);

  // Don't show on the alerts page itself, or if dismissed / no alert
  if (!alert || dismissed || loc.pathname === "/alerts") return null;

  const colors = LEVEL_COLORS[alert.level];

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        fontSize: 12,
        color: colors.text,
        flexShrink: 0,
        cursor: "pointer",
      }}
      onClick={() => nav("/alerts")}
    >
      <AlertTriangle size={14} style={{ flexShrink: 0 }} />

      <div style={{ flex: 1 }}>
        <strong>{alert.level} — {LEVEL_LABELS[alert.level]}</strong>
        {" "}
        <span style={{ color: "var(--c-text-secondary)" }}>
          {alert.reason} on {alert.object}
          {alert.namespace ? ` / ${alert.namespace}` : ""}
        </span>
      </div>

      <span style={{ fontSize: 11, color: "var(--c-text-muted)", flexShrink: 0 }}>
        View alerts
      </span>

      <button
        onClick={e => { e.stopPropagation(); setDismissed(true); }}
        aria-label="Dismiss alert banner"
        style={{
          background: "none",
          border: "none",
          color: colors.text,
          cursor: "pointer",
          padding: 2,
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          opacity: 0.7,
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
