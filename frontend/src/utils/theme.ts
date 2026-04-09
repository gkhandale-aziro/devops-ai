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
  // Backgrounds (dark surfaces, lightest → darkest depth order)
  bg: {
    base:     "#0d1117",   // page background
    panel:    "#0b0d14",   // sidebars, card bodies
    elevated: "#0f1219",   // headers, raised surfaces
    card:     "#1a1d27",   // cards, hover states
    active:   "#1e2340",   // active row/tab
  },

  // Borders (subtle → strong)
  border: {
    subtle: "#1e2235",
    muted:  "#2d3148",
    strong: "#2d3555",
  },

  // Text (primary → faint)
  text: {
    primary: "#e2e8f0",
    secondary: "#94a3b8",
    muted:   "#64748b",
    faint:   "#475569",
    dim:     "#334155",
  },

  // Brand / accent
  accent: {
    primary: "#6366f1",   // indigo — CTAs, active state
    light:   "#818cf8",   // indigo-300 — icons, highlights
    soft:    "#a78bfa",   // violet — network policies
  },

  // Semantic status
  status: {
    success: "#22c55e",   // healthy, bound, normal
    warning: "#f59e0b",   // pending, degraded, paused
    danger:  "#ef4444",   // failed, crashloop, lost
    info:    "#06b6d4",   // cyan — nodeport, images
    neutral: "#64748b",   // clusterip, generic
  },

  // Error surfaces
  error: {
    bg:     "#2a0011",
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
