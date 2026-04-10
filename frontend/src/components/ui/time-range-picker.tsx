/**
 * time-range-picker.tsx — Pill-button selector for chart time ranges.
 *
 * Renders a horizontal row of pill buttons ("1h", "6h", "24h", "7d").
 * Active pill uses accent background with white text; inactive pills
 * use elevated background with muted text. Inline styles only.
 */
import { C, SPACE, RADIUS } from "../../utils/theme";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TimeRangePickerProps {
  /** Currently selected range key. */
  value: string;
  /** Called when the user clicks a different range. */
  onChange: (range: string) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const RANGES = ["1h", "6h", "24h", "7d"] as const;

// ── Component ──────────────────────────────────────────────────────────────

/** Horizontal row of pill-shaped range buttons. */
export function TimeRangePicker({ value, onChange }: TimeRangePickerProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: SPACE.xs,
        padding: SPACE.xxs,
        background: C.bg.panel,
        borderRadius: RADIUS.lg,
        border: `1px solid ${C.border.subtle}`,
      }}
    >
      {RANGES.map((range) => {
        const active = range === value;
        return (
          <button
            key={range}
            type="button"
            aria-label={`Select ${range} time range`}
            aria-pressed={active}
            onClick={() => onChange(range)}
            style={{
              padding: `${SPACE.xs}px ${SPACE.md}px`,
              borderRadius: RADIUS.md,
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              lineHeight: 1,
              background: active ? C.accent.primary : "transparent",
              color: active ? "#ffffff" : C.text.muted,
              transition: "background 150ms ease, color 150ms ease",
            }}
          >
            {range}
          </button>
        );
      })}
    </div>
  );
}
