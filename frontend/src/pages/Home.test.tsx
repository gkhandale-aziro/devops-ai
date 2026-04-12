import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Home } from "./Home";

vi.mock("../api/client", () => ({
  api: {
    events: { list: vi.fn().mockResolvedValue([]) },
    stats: vi.fn().mockResolvedValue({ counts: {} }),
  },
}));

import { api } from "../api/client";
const mockEventsList = api.events.list as ReturnType<typeof vi.fn>;
const mockStats = api.stats as ReturnType<typeof vi.fn>;

vi.mock("../components/ui/health-summary", () => ({
  HealthSummaryBar: ({ targetId }: { targetId: string }) => (
    <div data-testid={`health-bar-${targetId}`}>HealthBar</div>
  ),
}));

const TARGET = {
  id: "t1",
  name: "test-cluster",
  type: "kubernetes" as const,
  status: "online" as const,
  config: { kubeconfig: "/path" },
};

describe("Home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing with empty targets", () => {
    render(
      <MemoryRouter>
        <Home targets={[]} monitorActive={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText("AziroOps")).toBeInTheDocument();
    expect(screen.getByText("No connections")).toBeInTheDocument();
  });

  it("renders with targets and shows target names", () => {
    render(
      <MemoryRouter>
        <Home targets={[TARGET]} monitorActive={false} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("test-cluster").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1 online")).toBeInTheDocument();
  });

  it("shows stat cards", () => {
    render(
      <MemoryRouter>
        <Home targets={[TARGET]} monitorActive={true} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("Connections").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Critical (SEV1)")).toBeInTheDocument();
    expect(screen.getByText("Warnings (SEV2)")).toBeInTheDocument();
    expect(screen.getByText("Monitor")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows quick action cards", () => {
    render(
      <MemoryRouter>
        <Home targets={[]} monitorActive={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Live Alerts")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("AI Chat")).toBeInTheDocument();
  });

  it("shows empty incidents state when no events", () => {
    render(
      <MemoryRouter>
        <Home targets={[]} monitorActive={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Recent Incidents")).toBeInTheDocument();
  });

  it("shows 'No incidents recorded yet' when API returns empty events", async () => {
    mockEventsList.mockResolvedValueOnce([]);
    mockStats.mockResolvedValueOnce({ counts: {} });
    render(
      <MemoryRouter>
        <Home targets={[]} monitorActive={false} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("No incidents recorded yet")).toBeInTheDocument();
    });
    expect(screen.getByText("Start monitoring a target to capture events.")).toBeInTheDocument();
  });

  it("renders recent incidents when API returns events", async () => {
    const events = [
      { id: 1, timestamp: new Date().toISOString(), source: "k8s", level: "SEV1", reason: "CrashLoopBackOff", object: "pod/nginx", namespace: "default", message: "Back-off restarting failed container", status: "open" },
      { id: 2, timestamp: new Date().toISOString(), source: "k8s", level: "SEV2", reason: "HighMemory", object: "node/worker-1", namespace: "", message: "Memory usage above 90%", status: "acknowledged" },
    ];
    mockEventsList.mockResolvedValueOnce(events);
    mockStats.mockResolvedValueOnce({ counts: { SEV1: 1, SEV2: 1 } });
    render(
      <MemoryRouter>
        <Home targets={[TARGET]} monitorActive={false} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("CrashLoopBackOff")).toBeInTheDocument();
    });
    expect(screen.getByText("HighMemory")).toBeInTheDocument();
    expect(screen.getByText("View all incidents")).toBeInTheDocument();
    // Status badges
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByText("acknowledged")).toBeInTheDocument();
    // Level badges
    expect(screen.getByText("SEV1")).toBeInTheDocument();
    expect(screen.getByText("SEV2")).toBeInTheDocument();
  });

  it("renders incident messages and object names", async () => {
    const events = [
      { id: 3, timestamp: new Date().toISOString(), source: "k8s", level: "SEV1", reason: "OOMKilled", object: "pod/api-server", namespace: "prod", message: "Container killed due to OOM", status: "resolved" },
    ];
    mockEventsList.mockResolvedValueOnce(events);
    mockStats.mockResolvedValueOnce({ counts: { SEV1: 1 } });
    render(
      <MemoryRouter>
        <Home targets={[]} monitorActive={false} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("OOMKilled")).toBeInTheDocument();
    });
    expect(screen.getByText(/pod\/api-server/)).toBeInTheDocument();
    expect(screen.getByText("Container killed due to OOM")).toBeInTheDocument();
    expect(screen.getByText("resolved")).toBeInTheDocument();
  });

  it("shows stat card counts from API", async () => {
    mockEventsList.mockResolvedValueOnce([]);
    mockStats.mockResolvedValueOnce({ counts: { SEV1: 3, SEV2: 7 } });
    render(
      <MemoryRouter>
        <Home targets={[TARGET]} monitorActive={false} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument();
    });
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("renders connections section with target cards linking to /dashboard", async () => {
    mockEventsList.mockResolvedValueOnce([]);
    mockStats.mockResolvedValueOnce({ counts: {} });
    render(
      <MemoryRouter>
        <Home targets={[TARGET]} monitorActive={false} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("No incidents recorded yet")).toBeInTheDocument();
    });
    // Connections section
    expect(screen.getAllByText("test-cluster").length).toBeGreaterThanOrEqual(1);
    // Connection card links to /dashboard
    const connectionLinks = screen.getAllByRole("link").filter(l => l.getAttribute("href") === "/dashboard");
    expect(connectionLinks.length).toBeGreaterThanOrEqual(1);
  });

  it("renders Workload Health section for online targets", async () => {
    mockEventsList.mockResolvedValueOnce([]);
    mockStats.mockResolvedValueOnce({ counts: {} });
    render(
      <MemoryRouter>
        <Home targets={[TARGET]} monitorActive={false} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Workload Health")).toBeInTheDocument();
    });
    expect(screen.getByTestId("health-bar-t1")).toBeInTheDocument();
  });

  it("does not show Workload Health when no online targets", async () => {
    const offlineTarget = { ...TARGET, status: "offline" as const };
    mockEventsList.mockResolvedValueOnce([]);
    mockStats.mockResolvedValueOnce({ counts: {} });
    render(
      <MemoryRouter>
        <Home targets={[offlineTarget]} monitorActive={false} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByText("No incidents recorded yet")).toBeInTheDocument();
    });
    expect(screen.queryByText("Workload Health")).not.toBeInTheDocument();
  });

  it("shows offline warning on stat card when targets are offline", async () => {
    const offlineTarget = { ...TARGET, status: "offline" as const };
    mockEventsList.mockResolvedValueOnce([]);
    mockStats.mockResolvedValueOnce({ counts: {} });
    render(
      <MemoryRouter>
        <Home targets={[offlineTarget]} monitorActive={false} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("1 offline")).toBeInTheDocument();
    });
  });

  it("shows Idle monitor state when monitorActive is false", () => {
    render(
      <MemoryRouter>
        <Home targets={[]} monitorActive={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.getByText("Start to capture events")).toBeInTheDocument();
  });

  it("handles API failure gracefully", async () => {
    mockEventsList.mockRejectedValueOnce(new Error("Network error"));
    mockStats.mockRejectedValueOnce(new Error("Network error"));
    render(
      <MemoryRouter>
        <Home targets={[]} monitorActive={false} />
      </MemoryRouter>,
    );
    // Should still render the page without crashing
    await waitFor(() => {
      expect(screen.getByText("No incidents recorded yet")).toBeInTheDocument();
    });
  });

  it("renders quick action links with correct hrefs", () => {
    render(
      <MemoryRouter>
        <Home targets={[]} monitorActive={false} />
      </MemoryRouter>,
    );
    const alertsLink = screen.getByText("Live Alerts").closest("a");
    expect(alertsLink).toHaveAttribute("href", "/alerts");
    const dashboardLink = screen.getByText("Dashboard").closest("a");
    expect(dashboardLink).toHaveAttribute("href", "/dashboard");
    const chatLink = screen.getByText("AI Chat").closest("a");
    expect(chatLink).toHaveAttribute("href", "/chat");
  });
});
