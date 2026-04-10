/**
 * metric-chart.tsx — Recharts-based chart components for metrics display.
 *
 * - MetricChart: area chart with gradient fill, optional threshold lines
 * - MiniSpark: tiny inline sparkline for stat cards (no axes, no tooltip)
 *
 * Both components are theme-aware via the C token object and use inline styles
 * consistent with the dashboard component conventions.
 */
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { C } from "../../utils/theme";

// ── Types ──────────────────────────────────────────────────────────────────

export interface MetricChartProps {
  /** Data points — `t` is an ISO timestamp string, `v` is the numeric value. */
  data: { t: string; v: number }[];
  /** Human-readable label shown in the tooltip header (e.g. "CPU Usage"). */
  label: string;
  /** Unit suffix for the Y-axis and tooltip (e.g. "%", "MB"). */
  unit?: string;
  /** Stroke / fill color — defaults to the accent primary indigo. */
  color?: string;
  /** Chart height in px — defaults to 160. */
  height?: number;
  /** Optional horizontal threshold lines at warn / danger levels. */
  thresholds?: { warn: number; danger: number };
}

export interface MiniSparkProps {
  /** Raw numeric values — rendered left-to-right. */
  data: number[];
  /** Stroke / gradient color. */
  color: string;
  /** Sparkline width in px — defaults to 80. */
  width?: number;
  /** Sparkline height in px — defaults to 28. */
  height?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Unique gradient id per chart instance to avoid SVG id collisions. */
let _gradientSeq = 0;

/**
 * Format an ISO timestamp for the X-axis.
 * Short ranges (< 24 h span) show "HH:mm"; longer ranges prefix with day name.
 */
function formatTimeLabel(iso: string, useDay: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (!useDay) return `${hh}:${mm}`;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return `${day} ${hh}:${mm}`;
}

/** Returns true when the data span exceeds 24 hours. */
function spanExceeds24h(data: { t: string }[]): boolean {
  if (data.length < 2) return false;
  const first = new Date(data[0].t).getTime();
  const last = new Date(data[data.length - 1].t).getTime();
  return Math.abs(last - first) > 24 * 60 * 60 * 1000;
}

// ── MetricChart ────────────────────────────────────────────────────────────

/** Area chart with gradient fill, responsive width, and optional threshold lines. */
export function MetricChart({
  data,
  label,
  unit = "",
  color = C.accent.primary,
  height = 160,
  thresholds,
}: MetricChartProps) {
  const gradientId = `mc-grad-${++_gradientSeq}`;
  const useDay = spanExceeds24h(data);

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            stroke={C.border.subtle}
            vertical={false}
          />

          <XAxis
            dataKey="t"
            tickFormatter={(v: string) => formatTimeLabel(v, useDay)}
            tick={{ fill: C.text.muted, fontSize: 11 }}
            axisLine={{ stroke: C.border.subtle }}
            tickLine={false}
            minTickGap={40}
          />

          <YAxis
            tickFormatter={(v: number) => `${v}${unit}`}
            tick={{ fill: C.text.muted, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />

          <Tooltip content={<ChartTooltip label={label} unit={unit} />} />

          {thresholds && (
            <>
              <ReferenceLine
                y={thresholds.warn}
                stroke={C.status.warning}
                strokeDasharray="6 3"
                strokeWidth={1.5}
              />
              <ReferenceLine
                y={thresholds.danger}
                stroke={C.status.danger}
                strokeDasharray="6 3"
                strokeWidth={1.5}
              />
            </>
          )}

          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 3, fill: color, stroke: "#fff", strokeWidth: 1.5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Tooltip ────────────────────────────────────────────────────────────────

interface TooltipPayloadEntry {
  value?: number;
  payload?: { t?: string };
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label: string;
  unit: string;
}) {
  if (!active || !payload?.length) return null;

  const entry = payload[0];
  const value = entry.value;
  const raw = entry.payload?.t;
  const ts = raw ? formatTimeLabel(raw, true) : "";

  return (
    <div
      style={{
        background: C.bg.elevated,
        border: `1px solid ${C.border.muted}`,
        borderRadius: 6,
        padding: "6px 10px",
        fontSize: 12,
        lineHeight: 1.5,
        color: C.text.primary,
        boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div>
        <span style={{ fontWeight: 700 }}>
          {value != null ? value : "—"}
          {unit}
        </span>
        {ts && (
          <span style={{ color: C.text.muted, marginLeft: 8 }}>{ts}</span>
        )}
      </div>
    </div>
  );
}

// ── MiniSpark ──────────────────────────────────────────────────────────────

/** Tiny inline sparkline — no axes, no tooltip, just a filled area curve. */
export function MiniSpark({
  data,
  color,
  width = 80,
  height = 28,
}: MiniSparkProps) {
  const gradientId = `ms-grad-${++_gradientSeq}`;
  const points = data.map((v, i) => ({ i, v }));

  return (
    <div style={{ width, height, flexShrink: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
