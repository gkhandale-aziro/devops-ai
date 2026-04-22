import { render, screen, fireEvent, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

/* ── Mock ALL hooks that create timers/intervals ── */
vi.mock("../hooks/useAutoRefresh", () => ({
  useAutoRefresh: vi.fn().mockReturnValue({
    interval: 30,
    setInterval: vi.fn(),
    lastRefreshed: new Date(),
    markRefreshed: vi.fn(),
    intervalOptions: [
      { label: "15s", value: 15 },
      { label: "30s", value: 30 },
      { label: "60s", value: 60 },
      { label: "Off", value: null },
    ],
  }),
  useStaleness: vi.fn().mockReturnValue({ label: "Updated just now", stale: false }),
}));

vi.mock("../hooks/useChat", () => ({
  useTargetChat: vi.fn().mockReturnValue({
    messages: [],
    loading: false,
    send: vi.fn(),
    retry: vi.fn(),
    edit: vi.fn(),
    clear: vi.fn(),
    respondToApproval: vi.fn(),
  }),
}));

vi.mock("../api/client", () => ({
  api: {
    tab: vi.fn().mockResolvedValue({ pods: "", nodes: "", output: "" }),
    namespaces: vi.fn().mockResolvedValue([]),
    chatStream: vi.fn().mockResolvedValue(new Response()),
    info: vi.fn().mockResolvedValue({ answer_model: "test" }),
  },
  readSSE: vi.fn(),
}));

vi.mock("../components/ChatPanel", () => ({
  ChatPanel: () => <div data-testid="chat-panel">ChatPanel</div>,
}));
vi.mock("../components/LogStream", () => ({
  LogStream: () => <div data-testid="log-stream">LogStream</div>,
}));
vi.mock("../components/ResourceGraph", () => ({
  ResourceGraph: () => <div data-testid="resource-graph">ResourceGraph</div>,
}));
vi.mock("./dashboard/primitives", () => ({
  NoTargetEmptyState: () => <div>Connect your first target</div>,
  ContextualHint: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SkeletonLoader: ({ variant }: { variant: string }) => <div data-testid={`skeleton-${variant}`}>Loading...</div>,
}));
vi.mock("./dashboard/tables", () => ({
  NodeTable: () => <div data-testid="node-table">NodeTable</div>,
  PodTable: () => <div data-testid="pod-table">PodTable</div>,
  LogsTab: () => <div data-testid="logs-tab">LogsTab</div>,
}));
vi.mock("./dashboard/tabs", () => ({
  OverviewTab: () => <div data-testid="overview-tab">OverviewTab</div>,
  GenericTab: () => <div data-testid="generic-tab">GenericTab</div>,
  EventsTab: () => <div data-testid="events-tab">EventsTab</div>,
  ServicesTab: () => <div data-testid="services-tab">ServicesTab</div>,
  WorkloadsTab: () => <div data-testid="workloads-tab">WorkloadsTab</div>,
  K8sStorageTab: () => <div data-testid="k8s-storage-tab">K8sStorageTab</div>,
  IngressTab: () => <div data-testid="ingress-tab">IngressTab</div>,
  NetworkTab: () => <div data-testid="network-tab">NetworkTab</div>,
  DockerContainersTab: () => <div>DockerContainersTab</div>,
  DockerVolumesTab: () => <div>DockerVolumesTab</div>,
  DockerImagesTab: () => <div>DockerImagesTab</div>,
  DockerStatsTab: () => <div>DockerStatsTab</div>,
  SSHServicesTab: () => <div>SSHServicesTab</div>,
  ProcessesTab: () => <div>ProcessesTab</div>,
  SecurityTab: () => <div>SecurityTab</div>,
}));

import React from "react";
import { api } from "../api/client";
import { Dashboard } from "./Dashboard";

const mockTab = api.tab as ReturnType<typeof vi.fn>;

const TARGET = {
  id: "t1",
  name: "test-cluster",
  type: "kubernetes" as const,
  status: "online" as const,
  config: { kubeconfig: "/path" },
};

const DOCKER_TARGET = {
  id: "t2",
  name: "docker-host",
  type: "docker" as const,
  status: "online" as const,
  config: {},
};

const SSH_TARGET = {
  id: "t3",
  name: "bastion",
  type: "ssh" as const,
  status: "online" as const,
  config: { host: "10.0.0.1" },
};

// Track interval IDs so we can kill leaked ones
let intervalsBefore: number;

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Capture current max interval ID so we can clear any new ones in afterEach
    intervalsBefore = (window as any).__nextIntervalId ?? 0;
  });

  afterEach(() => {
    // Force-clear any intervals that were created during the test
    const maxId = Number(setTimeout(() => {}, 0));
    for (let i = intervalsBefore; i <= maxId; i++) {
      clearInterval(i);
      clearTimeout(i);
    }
  });

  async function renderDashboard(target: typeof TARGET | typeof DOCKER_TARGET | typeof SSH_TARGET | null = TARGET) {
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <MemoryRouter>
          <Dashboard target={target} />
        </MemoryRouter>,
      );
    });
    return result!;
  }

  it("renders empty state when target is null", async () => {
    await renderDashboard(null);
    expect(screen.getByText("Connect your first target")).toBeInTheDocument();
  });

  it("renders with a target and shows target name", async () => {
    await renderDashboard();
    expect(screen.getByText("test-cluster")).toBeInTheDocument();
    expect(screen.getByText("kubernetes")).toBeInTheDocument();
  });

  it("shows the AI Chat tab button", async () => {
    await renderDashboard();
    expect(screen.getByRole("tab", { name: /AI Chat/i })).toBeInTheDocument();
  });

  it("shows the Topology tab for kubernetes targets", async () => {
    await renderDashboard();
    expect(screen.getByRole("tab", { name: /Topology/i })).toBeInTheDocument();
  });

  it("renders all K8s tab buttons", async () => {
    await renderDashboard();
    for (const name of ["Workloads", "Nodes", "Pods", "Services", "Ingress", "Storage", "Network", "Events"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  it("switches active tab when clicking a different tab", async () => {
    mockTab.mockResolvedValue({ output: "some-data" });
    await renderDashboard();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Pods" }));
    });
    expect(screen.getByRole("tab", { name: "Pods" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Workloads" })).toHaveAttribute("aria-selected", "false");
  });

  it("switches to AI Chat tab and shows ChatPanel", async () => {
    await renderDashboard();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /AI Chat/i }));
    });
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("switches to Topology tab and shows ResourceGraph", async () => {
    await renderDashboard();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /Topology/i }));
    });
    expect(screen.getByTestId("resource-graph")).toBeInTheDocument();
  });

  it("shows auto-refresh interval selector for data tabs", async () => {
    await renderDashboard();
    expect(screen.getByLabelText("Auto-refresh interval")).toBeInTheDocument();
  });

  it("shows Refresh button for data tabs", async () => {
    await renderDashboard();
    const refreshBtn = screen.getByLabelText("Refresh tab data");
    expect(refreshBtn).toBeInTheDocument();
    expect(refreshBtn).toHaveTextContent("Refresh");
  });

  it("hides auto-refresh controls when on AI Chat tab", async () => {
    await renderDashboard();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /AI Chat/i }));
    });
    expect(screen.queryByLabelText("Auto-refresh interval")).not.toBeInTheDocument();
  });

  it("shows namespace selector for K8s targets on data tabs", async () => {
    await renderDashboard();
    expect(screen.getByLabelText("Filter by namespace")).toBeInTheDocument();
  });

  it("hides namespace selector when on AI Chat tab", async () => {
    await renderDashboard();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /AI Chat/i }));
    });
    expect(screen.queryByLabelText("Filter by namespace")).not.toBeInTheDocument();
  });

  it("does not show Topology tab for docker targets", async () => {
    await renderDashboard(DOCKER_TARGET);
    expect(screen.queryByRole("tab", { name: /Topology/i })).not.toBeInTheDocument();
  });

  it("shows Topology tab for SSH targets", async () => {
    await renderDashboard(SSH_TARGET);
    expect(screen.getByRole("tab", { name: /Topology/i })).toBeInTheDocument();
  });

  it("does not show namespace selector for non-K8s targets", async () => {
    await renderDashboard(DOCKER_TARGET);
    expect(screen.queryByLabelText("Filter by namespace")).not.toBeInTheDocument();
  });

  it("persists active tab in localStorage", async () => {
    await renderDashboard();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Pods" }));
    });
    expect(localStorage.getItem("dashboard-tab-t1")).toBe("pods");
  });

  it("restores persisted tab from localStorage", async () => {
    localStorage.setItem("dashboard-tab-t1", "events");
    await renderDashboard();
    expect(screen.getByRole("tab", { name: "Events" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows error state when tab data load fails", async () => {
    mockTab.mockRejectedValueOnce(new Error("kubectl not found"));
    await renderDashboard();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders breadcrumb with target name", async () => {
    await renderDashboard();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("test-cluster")).toBeInTheDocument();
  });

  it("renders auto-refresh interval select with options", async () => {
    await renderDashboard();
    const refreshSelect = screen.getByLabelText("Auto-refresh interval");
    const options = refreshSelect.querySelectorAll("option");
    expect(options.length).toBeGreaterThanOrEqual(2);
  });

  it("shows staleness label near refresh controls", async () => {
    await renderDashboard();
    expect(screen.getByText("Updated just now")).toBeInTheDocument();
  });
});
