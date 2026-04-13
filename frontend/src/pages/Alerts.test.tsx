import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Alerts } from "./Alerts";

vi.mock("../api/client", () => ({
  api: {
    monitor: {
      start: vi.fn().mockResolvedValue({}),
      stop: vi.fn().mockResolvedValue({}),
      status: vi.fn().mockResolvedValue({ active: false, targets: [] }),
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

const TARGET2 = {
  id: "t2",
  name: "staging-cluster",
  type: "kubernetes" as const,
  status: "online" as const,
  config: { kubeconfig: "/path2" },
};

function makeAlert(overrides: Record<string, unknown> = {}) {
  return {
    type: "monitor_alert",
    level: "SEV1",
    reason: "CrashLoopBackOff",
    object: "pod/nginx",
    namespace: "default",
    message: "Container crashed",
    source: "kubelet",
    target_id: "t1",
    target_name: "test-cluster",
    ...overrides,
  };
}

describe("Alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  function renderAlerts(
    monitoringTargets = new Set<string>(),
    targets = [TARGET],
  ) {
    const onMonitoringChange = vi.fn();
    const result = render(
      <MemoryRouter>
        <Alerts
          targets={targets}
          monitoringTargets={monitoringTargets}
          onMonitoringChange={onMonitoringChange}
        />
      </MemoryRouter>,
    );
    return { ...result, onMonitoringChange };
  }

  it("renders without crashing", () => {
    renderAlerts();
    expect(screen.getByLabelText("Breadcrumb")).toBeInTheDocument();
    expect(screen.getAllByText("Live Alerts").length).toBeGreaterThanOrEqual(1);
  });

  it("shows severity counter badges", () => {
    renderAlerts();
    expect(screen.getAllByText("SEV1").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("SEV2").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("SEV3").length).toBeGreaterThanOrEqual(2);
  });

  it("shows empty state when no targets monitored", () => {
    renderAlerts();
    expect(screen.getByText("Monitor not active")).toBeInTheDocument();
    expect(screen.getByText("Select a target above and click Add to start monitoring.")).toBeInTheDocument();
  });

  it("shows target selector with unmonitored targets", () => {
    renderAlerts(new Set(), [TARGET, TARGET2]);
    expect(screen.getByLabelText("Select target to monitor")).toBeInTheDocument();
    expect(screen.getByText("test-cluster (kubernetes)")).toBeInTheDocument();
    expect(screen.getByText("staging-cluster (kubernetes)")).toBeInTheDocument();
  });

  it("hides already-monitored targets from selector", () => {
    renderAlerts(new Set(["t1"]), [TARGET, TARGET2]);
    // t1 is monitored, so only t2 should be in the dropdown
    expect(screen.queryByText("test-cluster (kubernetes)")).not.toBeInTheDocument();
    expect(screen.getByText("staging-cluster (kubernetes)")).toBeInTheDocument();
  });

  it("Add button is disabled when no target selected", () => {
    renderAlerts();
    const addBtn = screen.getByLabelText("Start monitoring selected target");
    expect(addBtn).toBeDisabled();
  });

  it("Add button calls api.monitor.start and updates state", async () => {
    const { api } = await import("../api/client");
    const { onMonitoringChange } = renderAlerts(new Set(), [TARGET]);

    const select = screen.getByLabelText("Select target to monitor");
    fireEvent.change(select, { target: { value: "t1" } });

    const addBtn = screen.getByLabelText("Start monitoring selected target");
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(api.monitor.start).toHaveBeenCalledWith("t1");
    });
    await waitFor(() => {
      expect(onMonitoringChange).toHaveBeenCalled();
    });
  });

  it("shows Stop All button when targets are monitored", () => {
    renderAlerts(new Set(["t1"]), [TARGET]);
    expect(screen.getByText("Stop All")).toBeInTheDocument();
  });

  it("Stop All calls api.monitor.stop and clears state", async () => {
    const { api } = await import("../api/client");
    const { onMonitoringChange } = renderAlerts(new Set(["t1"]), [TARGET]);

    fireEvent.click(screen.getByText("Stop All"));

    await waitFor(() => {
      expect(api.monitor.stop).toHaveBeenCalledWith();
    });
    await waitFor(() => {
      expect(onMonitoringChange).toHaveBeenCalledWith(new Set());
    });
  });

  it("shows target section when monitoring a target", () => {
    renderAlerts(new Set(["t1"]), [TARGET]);
    expect(screen.getByText("test-cluster")).toBeInTheDocument();
    expect(screen.getByText("kubernetes")).toBeInTheDocument();
    expect(screen.getByText("0 alerts")).toBeInTheDocument();
    expect(screen.getByText("No alerts — listening for events…")).toBeInTheDocument();
  });

  it("per-target Stop button calls api.monitor.stop with tid", async () => {
    const { api } = await import("../api/client");
    renderAlerts(new Set(["t1"]), [TARGET]);

    fireEvent.click(screen.getByLabelText("Stop monitoring test-cluster"));

    await waitFor(() => {
      expect(api.monitor.stop).toHaveBeenCalledWith("t1");
    });
  });

  it("shows multiple monitored target sections", () => {
    renderAlerts(new Set(["t1", "t2"]), [TARGET, TARGET2]);
    expect(screen.getByText("test-cluster")).toBeInTheDocument();
    expect(screen.getByText("staging-cluster")).toBeInTheDocument();
  });

  it("renders alert cards grouped under target when SSE events arrive", async () => {
    renderAlerts(new Set(["t1"]), [TARGET]);

    expect(capturedOnEvent).not.toBeNull();
    const { act } = await import("@testing-library/react");
    act(() => {
      capturedOnEvent!(makeAlert());
    });

    await waitFor(() => {
      expect(screen.getByText("CrashLoopBackOff")).toBeInTheDocument();
    });
    expect(screen.getByTestId("alert-card")).toBeInTheDocument();
    expect(screen.getByText("1 alert")).toBeInTheDocument();
  });

  it("ignores SSE events that are not monitor_alert type", async () => {
    renderAlerts(new Set(["t1"]), [TARGET]);

    const { act } = await import("@testing-library/react");
    act(() => {
      capturedOnEvent!({ type: "other_event", data: "irrelevant" });
    });

    expect(screen.queryByTestId("alert-card")).not.toBeInTheDocument();
  });

  it("ack button acknowledges an alert and shows toast", async () => {
    const { toast } = await import("../utils/toast");
    renderAlerts(new Set(["t1"]), [TARGET]);

    const { act } = await import("@testing-library/react");
    act(() => {
      capturedOnEvent!(makeAlert({ level: "SEV2", reason: "HighMemory" }));
    });

    await waitFor(() => {
      expect(screen.getByText("HighMemory")).toBeInTheDocument();
    });

    const ackBtns = screen.getAllByText("Ack");
    fireEvent.click(ackBtns[0]);
    expect(toast.success).toHaveBeenCalledWith("Alert acknowledged");
  });

  it("AI button opens AI drawer for alert", async () => {
    renderAlerts(new Set(["t1"]), [TARGET]);

    const { act } = await import("@testing-library/react");
    act(() => {
      capturedOnEvent!(makeAlert({ reason: "OOMKilled" }));
    });

    await waitFor(() => {
      expect(screen.getByText("OOMKilled")).toBeInTheDocument();
    });

    const aiBtns = screen.getAllByText("AI");
    fireEvent.click(aiBtns[0]);
    expect(screen.getByTestId("ai-drawer")).toBeInTheDocument();
  });

  it("severity counters update when alerts arrive", async () => {
    renderAlerts(new Set(["t1"]), [TARGET]);

    const { act } = await import("@testing-library/react");
    act(() => {
      capturedOnEvent!(makeAlert());
    });

    await waitFor(() => {
      const ones = screen.getAllByText("1");
      expect(ones.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("filter pills work — click SEV1 hides other levels", async () => {
    renderAlerts(new Set(["t1"]), [TARGET]);

    const { act } = await import("@testing-library/react");
    act(() => {
      capturedOnEvent!(makeAlert({ level: "SEV1", reason: "CriticalAlert" }));
      capturedOnEvent!(makeAlert({ level: "SEV2", reason: "WarningAlert" }));
    });

    await waitFor(() => {
      expect(screen.getByText("CriticalAlert")).toBeInTheDocument();
      expect(screen.getByText("WarningAlert")).toBeInTheDocument();
    });

    const allButtons = screen.getAllByRole("button");
    const sev1Pill = allButtons.find(b => b.textContent === "SEV1");
    fireEvent.click(sev1Pill!);

    expect(screen.queryByText("WarningAlert")).not.toBeInTheDocument();
    expect(screen.getByText("CriticalAlert")).toBeInTheDocument();
  });

  it("monitor active/inactive status indicator", () => {
    const { unmount } = renderAlerts(new Set(["t1"]), [TARGET]);
    expect(screen.getByRole("status", { name: "Monitor is active" })).toBeInTheDocument();
    unmount();

    renderAlerts(new Set(), [TARGET]);
    expect(screen.getByRole("status", { name: "Monitor is inactive" })).toBeInTheDocument();
  });

  it("shows live alerts feed region", () => {
    renderAlerts();
    expect(screen.getByRole("feed", { name: "Live alerts feed" })).toBeInTheDocument();
  });

  it("severity counters all show 0 when no alerts", () => {
    renderAlerts();
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBe(3);
  });

  it("default target option shows '— add target —'", () => {
    renderAlerts();
    expect(screen.getByText("— add target —")).toBeInTheDocument();
  });
});
