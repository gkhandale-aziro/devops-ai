import { render, screen } from "@testing-library/react";
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

vi.mock("../hooks/useSSE", () => ({
  useMonitorSSE: vi.fn(),
}));

vi.mock("../components/AlertCard", () => ({
  AlertCard: () => <div data-testid="alert-card">AlertCard</div>,
}));

vi.mock("../components/AIDrawer", () => ({
  AIDrawer: () => <div data-testid="ai-drawer" />,
}));

vi.mock("../utils/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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
});
