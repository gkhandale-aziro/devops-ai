/**
 * primitives.test.tsx — smoke tests for the leaf components extracted
 * from Dashboard.tsx. Each test asserts the minimum visible/behavioral
 * contract so a refactor cannot silently regress.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  RingChart,
  PodSummaryBar,
  Card,
  NoTargetEmptyState,
  ContextualHint,
  Pre,
  LoadingSpinner,
  SkeletonLoader,
} from "./primitives";

describe("RingChart", () => {
  it("renders the percentage as text", () => {
    render(<RingChart pct={42} color="#22c55e" />);
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("clamps values above 100 visually but still labels with raw value", () => {
    render(<RingChart pct={150} color="#ef4444" />);
    expect(screen.getByText("150%")).toBeInTheDocument();
  });
});

describe("PodSummaryBar", () => {
  it("renders running / pending / failed counts", () => {
    render(<PodSummaryBar counts={{ running: 5, pending: 1, bad: 2, total: 8 }} />);
    expect(screen.getByText("5 Running")).toBeInTheDocument();
    expect(screen.getByText("1 Pending")).toBeInTheDocument();
    expect(screen.getByText("2 Failed")).toBeInTheDocument();
    expect(screen.getByText("/ 8 total")).toBeInTheDocument();
  });

  it("shows an Other segment when counts do not sum to total", () => {
    render(<PodSummaryBar counts={{ running: 1, pending: 0, bad: 0, total: 4 }} />);
    expect(screen.getByText("3 Other")).toBeInTheDocument();
  });
});

describe("Card", () => {
  it("renders title and children when open", () => {
    render(<Card title="Pods"><div>child-content</div></Card>);
    expect(screen.getByText("Pods")).toBeInTheDocument();
    expect(screen.getByText("child-content")).toBeInTheDocument();
  });

  it("hides children after click and restores after second click", () => {
    render(<Card title="Nodes"><div>child-content</div></Card>);
    const header = screen.getByRole("button", { name: /Nodes/ });
    fireEvent.click(header);
    expect(screen.queryByText("child-content")).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText("child-content")).toBeInTheDocument();
  });

  it("toggles via Enter key (a11y)", () => {
    render(<Card title="Events"><div>child-content</div></Card>);
    const header = screen.getByRole("button", { name: /Events/ });
    fireEvent.keyDown(header, { key: "Enter" });
    expect(screen.queryByText("child-content")).not.toBeInTheDocument();
  });

  it("toggles via Space key (a11y)", () => {
    render(<Card title="Storage"><div>child-content</div></Card>);
    const header = screen.getByRole("button", { name: /Storage/ });
    fireEvent.keyDown(header, { key: " " });
    expect(screen.queryByText("child-content")).not.toBeInTheDocument();
  });

  it("respects defaultOpen=false", () => {
    render(<Card title="Closed" defaultOpen={false}><div>hidden-child</div></Card>);
    expect(screen.queryByText("hidden-child")).not.toBeInTheDocument();
  });
});

describe("NoTargetEmptyState", () => {
  it("shows the onboarding heading", () => {
    render(<NoTargetEmptyState />);
    expect(screen.getByRole("heading", { name: /Connect your first target/i })).toBeInTheDocument();
  });

  it("renders all four feature hints", () => {
    render(<NoTargetEmptyState />);
    expect(screen.getByText("Command Palette")).toBeInTheDocument();
    expect(screen.getByText("AI Chat")).toBeInTheDocument();
    expect(screen.getByText("Topology")).toBeInTheDocument();
    expect(screen.getByText("Live Logs")).toBeInTheDocument();
  });
});

describe("ContextualHint", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders children when not previously dismissed", () => {
    render(<ContextualHint id="test-hint">Hello tip</ContextualHint>);
    expect(screen.getByText("Hello tip")).toBeInTheDocument();
  });

  it("disappears after the dismiss button is clicked and persists in localStorage", () => {
    render(<ContextualHint id="test-hint">Hello tip</ContextualHint>);
    fireEvent.click(screen.getByRole("button", { name: /Dismiss tip/i }));
    expect(screen.queryByText("Hello tip")).not.toBeInTheDocument();
    expect(localStorage.getItem("hint-test-hint")).toBe("1");
  });

  it("does not render at all if localStorage already marks it dismissed", () => {
    localStorage.setItem("hint-already-gone", "1");
    render(<ContextualHint id="already-gone">Should not appear</ContextualHint>);
    expect(screen.queryByText("Should not appear")).not.toBeInTheDocument();
  });
});

describe("Pre", () => {
  it("renders children inside a <pre>", () => {
    const { container } = render(<Pre>some output</Pre>);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe("some output");
  });
});

describe("LoadingSpinner", () => {
  it("has an accessible loading status", () => {
    render(<LoadingSpinner />);
    expect(screen.getByRole("status")).toHaveAccessibleName("Loading");
  });
});

describe("SkeletonLoader", () => {
  it("has an accessible loading status", () => {
    render(<SkeletonLoader />);
    expect(screen.getByRole("status")).toHaveAccessibleName(/Loading content/);
  });
});
