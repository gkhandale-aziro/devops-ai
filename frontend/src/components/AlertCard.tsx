import type { MonitorAlert } from "../types";
import { LEVEL_COLORS }       from "../types";
import { LevelBadge }          from "./LevelBadge";

interface Props {
  alert: MonitorAlert & { ts: string };
  onClick?: () => void;
}

export function AlertCard({ alert, onClick }: Props) {
  const c = LEVEL_COLORS[alert.level];
  return (
    <div
      onClick={onClick}
      style={{
        background:   c.bg,
        border:       `1px solid #2d3148`,
        borderLeft:   `4px solid ${c.border}`,
        borderRadius: 6,
        padding:      "10px 12px",
        cursor:       onClick ? "pointer" : "default",
        userSelect:   "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <LevelBadge level={alert.level} />
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{alert.reason}</span>
        <span style={{ fontSize: 10, color: "#64748b", flexShrink: 0 }}>{alert.ts}</span>
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 2 }}>
        <strong>{alert.object}</strong>
        {alert.namespace ? <> &nbsp;·&nbsp; {alert.namespace}</> : null}
        &nbsp;·&nbsp; {alert.source}
      </div>
      {alert.message && (
        <div
          style={{
            fontSize:     11,
            color:        "#94a3b8",
            overflow:     "hidden",
            textOverflow: "ellipsis",
            whiteSpace:   "nowrap",
          }}
        >
          {alert.message}
        </div>
      )}
    </div>
  );
}
