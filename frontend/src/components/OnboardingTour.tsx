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
import { Joyride, STATUS, EVENTS, type Step, type EventData } from "react-joyride";

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
        primaryColor:       "var(--c-accent, #6366f1)",
        backgroundColor:    "var(--c-bg-card)",
        textColor:          "var(--c-text-primary)",
        arrowColor:         "var(--c-bg-card)",
        overlayColor:       "rgba(0, 0, 0, 0.65)",
        zIndex:             10_000,
      }}
      styles={{
        tooltip: {
          borderRadius: 12,
          border:       "1px solid var(--c-border)",
          padding:      16,
          fontSize:     13,
          fontFamily:   "inherit",
          boxShadow:    "0 24px 64px rgba(0,0,0,.5), 0 4px 16px rgba(0,0,0,.3)",
        },
        tooltipTitle: {
          fontSize:     14,
          fontWeight:   600,
          marginBottom: 6,
          color:        "var(--c-text-primary)",
        },
        tooltipContent: {
          padding:    0,
          lineHeight: 1.55,
          color:      "var(--c-text-secondary)",
        },
        buttonPrimary: {
          borderRadius: 6,
          fontSize:     12,
          fontWeight:   600,
          padding:      "6px 14px",
        },
        buttonBack: {
          color:    "var(--c-text-muted)",
          fontSize: 12,
        },
        buttonSkip: {
          color:    "var(--c-text-muted)",
          fontSize: 12,
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
