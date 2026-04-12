import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Alerts } from "./Alerts";

vi.mock("../api/client", () => ({
  api: {
    monitor: {
      start: vi.fn(),
      stop: vi.fn(),
      status: vi.fn().mockResolvedValue({ active: false }),
    },
  },
}));

// Capture the onEvent callback so tests can simulate SSE events
let capturedOnEvent: ((e: unknown) => void) | null = null;
vi.mock("../hooks/useSSE", () => ({
  useMonitorSSE: vi.fn((_active: boolean, onEvent: (e: unknown) => void) => {
    capturedOnEvent = onEvent;
  }),
}));

vi.mock("../components/AlertCard", () => ({
  AlertCard: ({ alert, onClick, onAck }: { alert: { id: number; reason: string; level: string }; onClick: () => void; onAck: () => void }) => (
    <div data-testid="alert-card">
      <span>{alert.reason}</span>
      <button data-testid={`ai-btn-${alert.id}`} onClick={onClick}>AI</button>
      <button data-testid={`ack-btn-${alert.id}`} onClick={onAck}>Ack</button>
    </div>
  ),
}));

vi.mock("../components/AIDrawer", () => ({
  AIDrawer: () => <div data-testid="ai-drawer" />,
}));

vi.mock("../utils/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../components/ui/empty-state", () => ({
  EmptyState: ({ title, description }: { title: string; description: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
}));

const TARGET = {
  id: "t1",
  name: "test-cluster",
  type: "kubernetes" as const,
  status: "online" as const,
  config: { kubeconfig: "/path" },
};

describe("Alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders without crashing", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("Breadcrumb")).toBeInTheDocument();
    expect(screen.getAllByText("Live Alerts").length).toBeGreaterThanOrEqual(1);
  });

  it("shows severity counter badges", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    // Each severity appears both as a counter label and a filter pill
    expect(screen.getAllByText("SEV1").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("SEV2").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("SEV3").length).toBeGreaterThanOrEqual(2);
  });

  it("shows Start button when monitor is inactive", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Start")).toBeInTheDocument();
  });

  it("shows Stop button when monitor is active", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={true} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Stop")).toBeInTheDocument();
  });

  it("shows empty state when no alerts", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Monitor not active")).toBeInTheDocument();
  });

  it("shows target selector", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("Select target to monitor")).toBeInTheDocument();
  });

  it("filter pills work — click SEV1 makes it active", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    // Find the filter pill buttons (not the counter labels)
    const allButtons = screen.getAllByRole("button");
    const sev1Pill = allButtons.find(b => b.textContent === "SEV1");
    expect(sev1Pill).toBeDefined();
    fireEvent.click(sev1Pill!);
    // After clicking, the SEV1 pill should have active styling (non-transparent background)
    expect(sev1Pill!.style.background).not.toBe("transparent");
  });

  it("shows waiting message when monitor active but no alerts", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={true} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("No alerts yet")).toBeInTheDocument();
    expect(screen.getByText("Waiting for events from the monitored target.")).toBeInTheDocument();
  });

  it("target selector has options from targets prop", () => {
    const targets = [
      TARGET,
      { id: "t2", name: "staging-cluster", type: "kubernetes" as const, status: "online" as const, config: { kubeconfig: "/path2" } },
    ];
    render(
      <MemoryRouter>
        <Alerts targets={targets} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    const select = screen.getByLabelText("Select target to monitor");
    expect(select).toBeInTheDocument();
    expect(screen.getByText("test-cluster (kubernetes)")).toBeInTheDocument();
    expect(screen.getByText("staging-cluster (kubernetes)")).toBeInTheDocument();
  });

  it("disables Start button when no target selected", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    const startBtn = screen.getByText("Start");
    expect(startBtn).toBeDisabled();
  });

  it("Start button calls api.monitor.start with selected target", async () => {
    const { api } = await import("../api/client");
    (api.monitor.start as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const onMonitorChange = vi.fn();
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={onMonitorChange} />
      </MemoryRouter>,
    );
    // Select a target first
    const select = screen.getByLabelText("Select target to monitor");
    fireEvent.change(select, { target: { value: "t1" } });

    // Now click Start
    const startBtn = screen.getByText("Start");
    expect(startBtn).not.toBeDisabled();
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(api.monitor.start).toHaveBeenCalledWith("t1");
    });
    await waitFor(() => {
      expect(onMonitorChange).toHaveBeenCalledWith(true);
    });
  });

  it("Stop button calls api.monitor.stop", async () => {
    const { api } = await import("../api/client");
    (api.monitor.stop as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const onMonitorChange = vi.fn();
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={true} onMonitorChange={onMonitorChange} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Stop"));

    await waitFor(() => {
      expect(api.monitor.stop).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onMonitorChange).toHaveBeenCalledWith(false);
    });
  });

  it("target selector persists to localStorage", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    const select = screen.getByLabelText("Select target to monitor");
    fireEvent.change(select, { target: { value: "t1" } });
    expect(localStorage.getItem("alerts_selectedTid")).toBe("t1");
  });

  it("target selector reads initial value from localStorage", () => {
    localStorage.setItem("alerts_selectedTid", "t1");
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    const select = screen.getByLabelText("Select target to monitor") as HTMLSelectElement;
    expect(select.value).toBe("t1");
  });

  it("filter pill 'All' shows all alerts", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    const allButtons = screen.getAllByRole("button");
    const allPill = allButtons.find(b => b.textContent === "All");
    expect(allPill).toBeDefined();
    fireEvent.click(allPill!);
    // "All" pill should have active styling
    expect(allPill!.style.background).not.toBe("transparent");
  });

  it("clicking SEV2 filter pill activates it", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    const allButtons = screen.getAllByRole("button");
    const sev2Pill = allButtons.find(b => b.textContent === "SEV2");
    expect(sev2Pill).toBeDefined();
    fireEvent.click(sev2Pill!);
    expect(sev2Pill!.style.background).not.toBe("transparent");
  });

  it("clicking SEV3 filter pill activates it", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    const allButtons = screen.getAllByRole("button");
    const sev3Pill = allButtons.find(b => b.textContent === "SEV3");
    expect(sev3Pill).toBeDefined();
    fireEvent.click(sev3Pill!);
    expect(sev3Pill!.style.background).not.toBe("transparent");
  });

  it("shows live alerts feed region", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("feed", { name: "Live alerts feed" })).toBeInTheDocument();
  });

  it("shows monitor active status indicator", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={true} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status", { name: "Monitor is active" })).toBeInTheDocument();
  });

  it("shows monitor inactive status indicator", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status", { name: "Monitor is inactive" })).toBeInTheDocument();
  });

  it("target selector is disabled when monitor is active", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={true} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    const select = screen.getByLabelText("Select target to monitor");
    expect(select).toBeDisabled();
  });

  it("target selector is enabled when monitor is inactive", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    const select = screen.getByLabelText("Select target to monitor");
    expect(select).not.toBeDisabled();
  });

  it("shows correct empty state descriptions for inactive vs active", () => {
    const { unmount } = render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Start monitoring a target to see live alerts here.")).toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={true} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Waiting for events from the monitored target.")).toBeInTheDocument();
  });

  it("severity counters all show 0 when no alerts", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    // Each severity counter should show "0"
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBe(3); // SEV1, SEV2, SEV3 all at 0
  });

  it("default target option shows '— target —'", () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={false} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("— target —")).toBeInTheDocument();
  });

  it("renders alert cards when SSE events arrive via onEvent callback", async () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={true} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );

    // Simulate an SSE event arriving
    expect(capturedOnEvent).not.toBeNull();
    const { act } = await import("@testing-library/react");
    act(() => {
      capturedOnEvent!({
        type: "monitor_alert",
        level: "SEV1",
        reason: "CrashLoopBackOff",
        object: "pod/nginx",
        namespace: "default",
        message: "Container crashed",
        source: "kubelet",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("CrashLoopBackOff")).toBeInTheDocument();
    });
    expect(screen.getByTestId("alert-card")).toBeInTheDocument();
  });

  it("ignores SSE events that are not monitor_alert type", async () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={true} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );

    const { act } = await import("@testing-library/react");
    act(() => {
      capturedOnEvent!({ type: "other_event", data: "irrelevant" });
    });

    // No alert cards should appear
    expect(screen.queryByTestId("alert-card")).not.toBeInTheDocument();
  });

  it("ack button acknowledges an alert and shows toast", async () => {
    const { toast } = await import("../utils/toast");
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={true} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );

    const { act } = await import("@testing-library/react");
    act(() => {
      capturedOnEvent!({
        type: "monitor_alert",
        level: "SEV2",
        reason: "HighMemory",
        object: "pod/app",
        namespace: "prod",
        message: "Memory above 90%",
        source: "metrics",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("HighMemory")).toBeInTheDocument();
    });

    // Click the Ack button on the alert card
    const ackBtns = screen.getAllByText("Ack");
    fireEvent.click(ackBtns[0]);

    expect(toast.success).toHaveBeenCalledWith("Alert acknowledged");
  });

  it("AI button opens AI drawer for alert", async () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={true} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );

    const { act } = await import("@testing-library/react");
    act(() => {
      capturedOnEvent!({
        type: "monitor_alert",
        level: "SEV1",
        reason: "OOMKilled",
        object: "pod/worker",
        namespace: "default",
        message: "Out of memory",
        source: "kubelet",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("OOMKilled")).toBeInTheDocument();
    });

    // Click the AI button
    const aiBtns = screen.getAllByText("AI");
    fireEvent.click(aiBtns[0]);

    // AI drawer mock should be present
    expect(screen.getByTestId("ai-drawer")).toBeInTheDocument();
  });

  it("Clear button appears when alerts exist and clears them", async () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={true} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );

    // Initially no Clear button (no alerts)
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();

    const { act } = await import("@testing-library/react");
    act(() => {
      capturedOnEvent!({
        type: "monitor_alert",
        level: "SEV3",
        reason: "Warning",
        object: "pod/test",
        namespace: "default",
        message: "Low disk",
        source: "node",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Warning")).toBeInTheDocument();
    });

    // Clear button should now appear
    const clearBtn = screen.getByText("Clear");
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);

    // Alerts should be gone
    await waitFor(() => {
      expect(screen.queryByText("Warning")).not.toBeInTheDocument();
    });
  });

  it("severity counters update when alerts arrive", async () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={true} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );

    const { act } = await import("@testing-library/react");
    act(() => {
      capturedOnEvent!({
        type: "monitor_alert",
        level: "SEV1",
        reason: "CriticalError",
        object: "pod/db",
        namespace: "default",
        message: "DB down",
        source: "kubelet",
      });
    });

    await waitFor(() => {
      // SEV1 counter should show 1
      const ones = screen.getAllByText("1");
      expect(ones.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("filter pills hide non-matching alerts", async () => {
    render(
      <MemoryRouter>
        <Alerts targets={[TARGET]} monitorActive={true} onMonitorChange={vi.fn()} />
      </MemoryRouter>,
    );

    const { act } = await import("@testing-library/react");
    // Add a SEV1 and a SEV2 alert
    act(() => {
      capturedOnEvent!({
        type: "monitor_alert",
        level: "SEV1",
        reason: "CriticalAlert",
        object: "pod/a",
        namespace: "default",
        message: "Critical",
        source: "kubelet",
      });
      capturedOnEvent!({
        type: "monitor_alert",
        level: "SEV2",
        reason: "WarningAlert",
        object: "pod/b",
        namespace: "default",
        message: "Warning",
        source: "kubelet",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("CriticalAlert")).toBeInTheDocument();
      expect(screen.getByText("WarningAlert")).toBeInTheDocument();
    });

    // Click SEV1 filter pill
    const allButtons = screen.getAllByRole("button");
    const sev1Pill = allButtons.find(b => b.textContent === "SEV1");
    fireEvent.click(sev1Pill!);

    // SEV2 alert should be hidden
    expect(screen.queryByText("WarningAlert")).not.toBeInTheDocument();
    // SEV1 alert should still be visible
    expect(screen.getByText("CriticalAlert")).toBeInTheDocument();
  });
});
