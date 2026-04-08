/**
 * Shared animation constants — micro-interactions skill.
 * All durations/easings follow the timing reference from the skill:
 *   hover/click: 100ms ease-out
 *   toggle/badge: 150-200ms spring
 *   complex: 200-300ms ease-out
 */

export const EASING = {
  out:    "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  in:     "cubic-bezier(0.55, 0.055, 0.675, 0.19)",
} as const;

export const DUR = {
  instant: "50ms",
  hover:   "100ms",
  toggle:  "180ms",
  complex: "250ms",
} as const;

/** Returns empty string when user has requested reduced motion */
export function motionSafe(value: string): string {
  if (typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return "";
  }
  return value;
}

/** Shared button transition string */
export const BTN_TRANSITION =
  `transform ${DUR.hover} ${EASING.out}, ` +
  `box-shadow ${DUR.hover} ${EASING.out}, ` +
  `background ${DUR.hover} ${EASING.out}, ` +
  `border-color ${DUR.hover} ${EASING.out}, ` +
  `color ${DUR.hover} ${EASING.out}`;

/** Apply on hover — lifts button up 1px + adds shadow */
export const btnHoverStyle = {
  transform:  "translateY(-1px)",
  boxShadow:  "0 4px 12px rgba(0,0,0,0.3)",
};

/** Apply on active/press — squash slightly (Squash & Stretch principle) */
export const btnActiveStyle = {
  transform:  "translateY(0) scale(0.97)",
  boxShadow:  "0 1px 3px rgba(0,0,0,0.2)",
};

/** Tab bar button transition */
export const TAB_TRANSITION =
  `color ${DUR.hover} ${EASING.out}, ` +
  `border-color ${DUR.toggle} ${EASING.out}, ` +
  `background ${DUR.hover} ${EASING.out}`;

/** Tab hover style for inactive tabs */
export const tabHoverStyle = {
  color: "#94a3b8",
  background: "rgba(99,102,241,0.06)",
};

/** Global keyframes CSS — inject once via <style> tag */
export const GLOBAL_KEYFRAMES = `
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes slideUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes slideInRight {
  from { opacity: 0; transform: translateX(40px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.5; }
}
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
/* Keyboard-visible focus ring — applied globally to any interactive element
   that doesn't already set its own outline. Mouse clicks don't trigger this,
   so it only appears for tab/arrow-key navigation. */
:focus-visible {
  outline: 2px solid #818cf8 !important;
  outline-offset: 2px;
  border-radius: 4px;
}
`;

/** FadeIn wrapper style for tab content */
export const fadeInStyle = {
  animation: "fadeIn 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94) both",
};

/** Pulse style for status indicator dots */
export const statusPulseStyle = {
  animation: "pulse 2s ease-in-out infinite",
};

/** Skeleton shimmer gradient for loading placeholders */
export const skeletonStyle = {
  background: "linear-gradient(90deg, #1a1d27 25%, #2d3148 50%, #1a1d27 75%)",
  backgroundSize: "200% 100%",
  animation: "shimmer 1.5s ease-in-out infinite",
  borderRadius: 6,
};
