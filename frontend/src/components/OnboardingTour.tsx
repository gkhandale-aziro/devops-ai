/**
 * OnboardingTour — first-run guided walkthrough of Aziro's core primitives.
 *
 * Shows 5 steps the first time a user lands on the app, then stores a
 * flag in localStorage so it never auto-runs again. Can be replayed
 * manually from Settings → "Replay tour".
 *
 * Targets are matched via `data-tour="..."` attributes on the relevant
 * elements (Sidebar Add Connection button, model picker, top-bar search).
 * Using data attributes keeps the tour decoupled from styling changes —
 * renaming a className won't break the walkthrough.
 *
 * Uses react-joyride v3's named export + onEvent callback signature.
 */
import { useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { Joyride, STATUS, EVENTS, type Step, type EventData, type TooltipRenderProps } from "react-joyride";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT } from "../utils/theme";

/**
 * Custom tooltip — identical to Joyride's DefaultTooltip except the title
 * renders as a `<p>` instead of `<h4>`. Joyride's hardcoded `<h4>` breaks
 * heading-order (Lighthouse a11y) because no <h1>–<h3> exists on the page.
 */
function TourTooltip(props: TooltipRenderProps) {
  const { backProps, index, isLastStep, primaryProps, skipProps, step, tooltipProps } = props;
  const { buttons, content, styles, title } = step;
  const btns: Record<string, ReactNode> = {};

  if (buttons.includes("primary"))
    btns.primary = <button data-testid="button-primary" style={styles.buttonPrimary} type="button" {...primaryProps} />;
  if (buttons.includes("skip") && !isLastStep)
    btns.skip = <button aria-live="off" data-testid="button-skip" style={styles.buttonSkip} type="button" {...skipProps} />;
  if (buttons.includes("back") && index > 0)
    btns.back = <button data-testid="button-back" style={styles.buttonBack} type="button" {...backProps} />;

  return (
    <div key="JoyrideTooltip" className="react-joyride__tooltip" data-joyride-step={index}
      style={styles.tooltip} {...tooltipProps}
      {...(title ? { "aria-labelledby": "joyride-tooltip-title", "aria-describedby": "joyride-tooltip-content" } : { "aria-describedby": "joyride-tooltip-content" })}
    >
      <div style={styles.tooltipContainer}>
        {title && <p id="joyride-tooltip-title" style={{ ...styles.tooltipTitle, margin: 0 }}>{title}</p>}
        <div id="joyride-tooltip-content" style={styles.tooltipContent}>{content}</div>
      </div>
      {buttons.some(b => b === "back" || b === "primary" || b === "skip") && (
        <div style={styles.tooltipFooter}>
          <div style={styles.tooltipFooterSpacer}>{btns.skip}</div>
          {btns.back}
          {btns.primary}
        </div>
      )}
    </div>
  );
}

const TOUR_SEEN_KEY = "aziro-tour-seen";

const STEPS: Step[] = [
  {
    target: "body",
    placement: "center",
    title: "Welcome to Aziro Ops",
    content:
      "Aziro is an AI copilot for running Linux, Kubernetes, Docker, and cloud infra. Here's a 30-second tour of the essentials — you can replay it anytime from Settings.",
  },
  {
    target: '[data-tour="add-connection"]',
    placement: "right",
    title: "Add your first target",
    content:
      "Connect an SSH server, Kubernetes cluster, Docker host, or cloud account. Everything else in the app hangs off this list.",
  },
  {
    target: '[data-tour="search"]',
    placement: "bottom",
    title: "Cmd/Ctrl + K — command palette",
    content:
      'Jump to any target, page, pod, or node. Type "describe nginx" or "logs api" to run actions straight from the palette.',
  },
  {
    target: '[data-tour="model-picker"]',
    placement: "top",
    title: "Active AI model",
    content:
      "Click here to switch between Gemini, OpenAI, Claude, Groq, or local Ollama. The indicator dot shows health — green means ready, amber means fallback.",
  },
  {
    target: "body",
    placement: "center",
    title: "You're set",
    content:
      'Press "?" anywhere for the full shortcut cheat sheet. Happy debugging.',
  },
];

export function OnboardingTour() {
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // Auto-run the first time, and listen for a global "replay" event dispatched
  // from Settings. Storing the flag in localStorage keeps it per-browser —
  // fine for a single-user developer tool.
  useEffect(() => {
    if (!localStorage.getItem(TOUR_SEEN_KEY)) {
      // Delay so the sidebar + top bar have mounted and animated in before
      // Joyride starts measuring target bounding rects.
      const t = setTimeout(() => setRun(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    const replay = () => { setStepIndex(0); setRun(true); };
    window.addEventListener("aziro-tour-replay", replay);
    return () => window.removeEventListener("aziro-tour-replay", replay);
  }, []);

  const handleEvent = useCallback((data: EventData) => {
    const { status, type, index } = data;
    // Track the current step so replay from Settings resumes from step 0
    // instead of wherever the previous run stopped.
    if (type === EVENTS.STEP_AFTER) {
      setStepIndex(index + 1);
    }
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      localStorage.setItem(TOUR_SEEN_KEY, "1");
      setRun(false);
      setStepIndex(0);
    }
  }, []);

  return (
    <Joyride
      steps={STEPS}
      run={run}
      stepIndex={stepIndex}
      continuous
      tooltipComponent={TourTooltip}
      onEvent={handleEvent}
      locale={{
        back:  "Back",
        close: "Close",
        last:  "Done",
        next:  "Next",
        skip:  "Skip",
      }}
      options={{
        // Show back, skip, and primary (Next/Done). Omit `close` because
        // overlayClickAction=false already disables the x-less workflow.
        buttons:            ["back", "skip", "primary"],
        showProgress:       true,
        skipBeacon:         true,
        overlayClickAction: false,
        primaryColor:       "#4f46e5",  // darker indigo — passes WCAG AA contrast on white text (5.5:1); intentionally not C.accent.primary for contrast
        backgroundColor:    "var(--c-bg-card)",
        textColor:          "var(--c-text-primary)",
        arrowColor:         "var(--c-bg-card)",
        overlayColor:       "rgba(0, 0, 0, 0.65)",
        zIndex:             10_000,
      }}
      styles={{
        tooltip: {
          borderRadius: RADIUS.xl,
          border:       `1px solid ${C.border.muted}`,
          padding:      SPACE.lg,
          fontSize:     FONT_SIZE.md,
          fontFamily:   "inherit",
          boxShadow:    "0 24px 64px rgba(0,0,0,.5), 0 4px 16px rgba(0,0,0,.3)",
        },
        tooltipTitle: {
          fontSize:     FONT_SIZE.lg,
          fontWeight:   FONT_WEIGHT.semibold,
          marginBottom: SPACE.sm,
          color:        C.text.primary,
        },
        tooltipContent: {
          padding:    0,
          lineHeight: 1.55,
          color:      C.text.secondary,
        },
        buttonPrimary: {
          borderRadius: RADIUS.md,
          fontSize:     FONT_SIZE.sm,
          fontWeight:   FONT_WEIGHT.semibold,
          padding:      `${SPACE.sm}px ${SPACE.md}px`,
        },
        buttonBack: {
          color:    C.text.muted,
          fontSize: FONT_SIZE.sm,
        },
        buttonSkip: {
          color:    C.text.muted,
          fontSize: FONT_SIZE.sm,
        },
      }}
    />
  );
}

/** Imperatively replay the tour from anywhere (used by Settings). */
export function replayOnboardingTour() {
  localStorage.removeItem(TOUR_SEEN_KEY);
  window.dispatchEvent(new Event("aziro-tour-replay"));
}
