/**
 * Design tokens — shared palette + spacing.
 *
 * These are the hex literals and numeric spacings repeated across
 * `pages/dashboard/*` and elsewhere. Import from here instead of
 * re-typing hex codes so the palette stays consistent and can be
 * themed later in one place.
 */

// ── Colors ─────────────────────────────────────────────────────────────────

/**
 * Color tokens grouped by purpose.
 * - `bg.*`     — dark surfaces from deepest (base) to most elevated (active)
 * - `border.*` — three strengths (subtle, muted, strong)
 * - `text.*`   — from primary foreground to faint hints
 * - `accent.*` — indigo/violet brand colors
 * - `status.*` — semantic (success / warning / danger / info / neutral)
 * - `error.*`  — error toast/banner surface
 */
export const C = {
  // Backgrounds — all reference CSS custom properties so they adapt to Day/Night
  bg: {
    base:     "var(--c-bg-base)",
    panel:    "var(--c-bg-panel)",
    elevated: "var(--c-bg-raised)",
    card:     "var(--c-bg-card)",
    active:   "var(--c-bg-active)",
  },

  // Borders
  border: {
    subtle: "var(--c-border-subtle)",
    muted:  "var(--c-border)",
    strong: "var(--c-border-strong)",
  },

  // Text
  text: {
    primary:   "var(--c-text-primary)",
    secondary: "var(--c-text-secondary)",
    muted:     "var(--c-text-muted)",
    faint:     "var(--c-text-faint)",
    dim:       "var(--c-text-dim)",
  },

  // Brand / accent — same in both themes
  accent: {
    primary: "#6366f1",
    light:   "#818cf8",
    soft:    "#a78bfa",
  },

  // Semantic status — same in both themes (used with opacity concatenation)
  status: {
    success: "#22c55e",
    warning: "#f59e0b",
    danger:  "#ef4444",
    info:    "#06b6d4",
    neutral: "#64748b",
  },

  // Error surfaces
  error: {
    bg:     "var(--c-sev1-bg)",
    border: "#f43f5e",
    text:   "#fb7185",
  },
} as const;

// ── Spacing (px) ───────────────────────────────────────────────────────────

/** 4-point spacing scale: xxs=2, xs=4, sm=8, md=12, lg=16, xl=20, xxl=24 */
export const SPACE = {
  xxs: 2,
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  xxl: 24,
} as const;

/** Common border radius tokens. */
export const RADIUS = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  pill: 999,
} as const;

// ── Timing (ms) ────────────────────────────────────────────────────────────

/**
 * Animation / auto-dismiss timings used across the app.
 * - `toastDismiss`    — error toast auto-dismiss window
 * - `pulse`           — attention-pulse animation period
 * - `transition`      — default UI transition (hover, expand/collapse)
 * - `transitionFast`  — snappier hover/focus transitions
 */
export const TIMING = {
  toastDismiss:    6000,
  pulse:           2000,
  transition:      300,
  transitionFast:  150,
} as const;

// ── Typography ────────────────────────────────────────────────────────────

/** Font-size scale (px) — max 7 levels. Use instead of magic numbers. */
export const FONT_SIZE = {
  xs:   10,   // badges, metadata labels
  sm:   11,   // captions, secondary text
  md:   13,   // body text (base)
  lg:   15,   // subheadings, card titles
  xl:   18,   // section headings
  xxl:  24,   // page headings
  hero: 32,   // stat card hero numbers
} as const;

/** Font-weight scale. */
export const FONT_WEIGHT = {
  normal:   400,
  medium:   500,
  semibold: 600,
  bold:     700,
  black:    800,
} as const;

// ── Elevation ─────────────────────────────────────────────────────────────

/** Box-shadow tokens — reference CSS vars so they adapt to Day/Night. */
export const SHADOW = {
  sm:   "var(--shadow-sm)",
  md:   "var(--shadow-md)",
  lg:   "var(--shadow-lg)",
  glow: "var(--shadow-glow-accent)",
} as const;

// ── Z-index ───────────────────────────────────────────────────────────────

/** Z-index scale — use instead of arbitrary numbers. */
export const Z_INDEX = {
  base:     0,
  dropdown: 50,
  sticky:   100,
  modal:    200,
  toast:    300,
  tooltip:  400,
} as const;
