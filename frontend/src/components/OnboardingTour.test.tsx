import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("react-joyride", () => ({
  Joyride: ({ run, steps }: any) =>
    run ? (
      <div data-testid="joyride" data-steps={steps.length}>
        Tour running
      </div>
    ) : null,
  STATUS: { FINISHED: "finished", SKIPPED: "skipped" },
  EVENTS: { STEP_AFTER: "step:after" },
}));

import { OnboardingTour, replayOnboardingTour } from "./OnboardingTour";

describe("OnboardingTour", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not render when tour already seen", () => {
    localStorage.setItem("aziro-tour-seen", "1");
    render(<OnboardingTour />);
    act(() => { vi.advanceTimersByTime(700); });
    expect(screen.queryByTestId("joyride")).not.toBeInTheDocument();
  });

  it("renders tour with 5 steps on first visit after delay", () => {
    render(<OnboardingTour />);
    // Before the delay, tour should not be visible
    expect(screen.queryByTestId("joyride")).not.toBeInTheDocument();
    // After the 600ms startup delay
    act(() => { vi.advanceTimersByTime(700); });
    const joyride = screen.getByTestId("joyride");
    expect(joyride).toBeInTheDocument();
    expect(joyride.getAttribute("data-steps")).toBe("5");
  });

  it("replayOnboardingTour removes localStorage flag and dispatches event", () => {
    localStorage.setItem("aziro-tour-seen", "1");
    const handler = vi.fn();
    window.addEventListener("aziro-tour-replay", handler);

    replayOnboardingTour();

    expect(localStorage.getItem("aziro-tour-seen")).toBeNull();
    expect(handler).toHaveBeenCalledOnce();

    window.removeEventListener("aziro-tour-replay", handler);
  });

  it("starts tour on replay event even after previously seen", () => {
    localStorage.setItem("aziro-tour-seen", "1");
    render(<OnboardingTour />);
    act(() => { vi.advanceTimersByTime(700); });
    expect(screen.queryByTestId("joyride")).not.toBeInTheDocument();

    // Dispatch replay event
    act(() => { replayOnboardingTour(); });
    expect(screen.getByTestId("joyride")).toBeInTheDocument();
  });
});
