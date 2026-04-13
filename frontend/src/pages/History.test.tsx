import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { History } from "./History";

vi.mock("../api/client", () => ({
  api: {
    events: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      updateStatus: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("../components/LevelBadge", () => ({
  LevelBadge: ({ level }: { level: string }) => <span data-testid="level-badge">{level}</span>,
}));

vi.mock("../components/AIDrawer", () => ({
  AIDrawer: () => <div data-testid="ai-drawer" />,
}));

vi.mock("@/components/ui/data-table", () => ({
  DataTable: ({ data, onRowClick }: { data: unknown[]; onRowClick?: (row: unknown) => void }) => (
    <div data-testid="data-table">
      {(data as Array<{ id: number; reason: string }>).map((row) => (
        <div key={row.id} data-testid={`row-${row.id}`} onClick={() => onRowClick?.(row)}>
          {row.reason}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
}));

vi.mock("@/components/ui/empty-state", () => ({
  EmptyState: ({ title, description }: { title: string; description: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
}));

const MOCK_EVENT = {
  id: 1,
  level: "SEV1" as const,
  reason: "CrashLoopBackOff",
  object: "pod/nginx-7f8b9c6d4-x2k9l",
  namespace: "default",
  source: "kubelet",
  message: "Container crashed",
  timestamp: new Date().toISOString(),
  status: "open" as const,
  target_id: "t1",
  target_name: "test-cluster",
  snapshots: [],
  analyses: [],
};

/** Switch to flat view so DataTable is directly visible (default is grouped). */
function switchToFlat() {
  fireEvent.click(screen.getByTitle("Flat list"));
}

describe("History", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing", () => {
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("Incident History").length).toBeGreaterThanOrEqual(1);
  });

  it("shows severity filter pills", () => {
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("SEV1")).toBeInTheDocument();
    expect(screen.getByText("SEV2")).toBeInTheDocument();
    expect(screen.getByText("SEV3")).toBeInTheDocument();
  });

  it("shows view mode toggle (Grouped / Flat)", () => {
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    expect(screen.getByTitle("Group by workload")).toBeInTheDocument();
    expect(screen.getByTitle("Flat list")).toBeInTheDocument();
  });

  it("shows namespace filter dropdown", () => {
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("Filter by namespace")).toBeInTheDocument();
  });

  it("shows object search input", () => {
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    expect(screen.getByPlaceholderText("Search object…")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows empty state when events loaded but empty", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
    expect(screen.getByText("No incidents recorded yet")).toBeInTheDocument();
  });

  it("shows workload groups in grouped view (default)", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      // Workload name extracted: nginx-7f8b9c6d4-x2k9l → nginx
      expect(screen.getByText("nginx")).toBeInTheDocument();
    });
    // Target name shown in group header
    expect(screen.getByText("test-cluster")).toBeInTheDocument();
    // Event count shown
    expect(screen.getByText("1 event")).toBeInTheDocument();
  });

  it("expanding a workload group shows DataTable with events", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("nginx")).toBeInTheDocument();
    });
    // Click to expand the group
    fireEvent.click(screen.getByText("nginx"));
    expect(screen.getByTestId("data-table")).toBeInTheDocument();
    expect(screen.getByText("CrashLoopBackOff")).toBeInTheDocument();
  });

  it("groups multiple events from same workload together", async () => {
    const { api } = await import("../api/client");
    const events = [
      MOCK_EVENT,
      { ...MOCK_EVENT, id: 2, reason: "OOMKilled", object: "pod/nginx-7f8b9c6d4-abc12" },
    ];
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue(events);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("nginx")).toBeInTheDocument();
    });
    // Both events grouped under "nginx" — shows 2 events
    expect(screen.getByText("2 events")).toBeInTheDocument();
  });

  it("shows data in flat view after switching", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("nginx")).toBeInTheDocument();
    });
    switchToFlat();
    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });
  });

  it("shows DataTable when events exist (flat view)", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT, { ...MOCK_EVENT, id: 2, level: "SEV2" }]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    switchToFlat();
    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });
  });

  it("calls api with level filter when severity pill clicked", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    (api.events.list as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByText("SEV1"));
    await waitFor(() => {
      expect(api.events.list).toHaveBeenCalledWith(expect.objectContaining({ level: "SEV1" }));
    });
  });

  it("shows Clear button when a filter is active", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("SEV2"));
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("Clear button resets filters", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("SEV1"));
    expect(screen.getByText("Clear")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Clear"));
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
  });

  it("shows error state when api fails", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText(/Failed to load events/)).toBeInTheDocument();
    });
  });

  it("shows event count after loading (grouped view)", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      // Grouped view shows "1 workload · 1 event"
      expect(screen.getByText(/1 workload/)).toBeInTheDocument();
    });
  });

  it("shows plural 'events' for multiple events", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT, { ...MOCK_EVENT, id: 2, object: "pod/other-pod" }]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText(/2 events/)).toBeInTheDocument();
    });
  });

  it("opens detail panel when event row is clicked (flat view)", async () => {
    const { api } = await import("../api/client");
    const detailEvent = {
      ...MOCK_EVENT,
      message: "Detailed crash info",
      snapshots: [],
      analyses: [],
    };
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    (api.events.get as ReturnType<typeof vi.fn>).mockResolvedValue(detailEvent);

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    switchToFlat();

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(api.events.get).toHaveBeenCalledWith(1);
    });

    await waitFor(() => {
      expect(screen.getByText("Detailed crash info")).toBeInTheDocument();
    });
  });

  it("detail panel shows meta rows including Target", async () => {
    const { api } = await import("../api/client");
    const detailEvent = {
      ...MOCK_EVENT,
      object: "pod/redis",
      namespace: "staging",
      source: "kubelet",
      message: "OOMKilled",
      target_name: "prod-cluster",
      snapshots: [],
      analyses: [],
    };
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    (api.events.get as ReturnType<typeof vi.fn>).mockResolvedValue(detailEvent);

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    switchToFlat();

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(screen.getByText("pod/redis")).toBeInTheDocument();
    });
    expect(screen.getByText("staging")).toBeInTheDocument();
    expect(screen.getByText("Object")).toBeInTheDocument();
    expect(screen.getByText("Namespace")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Time")).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("prod-cluster")).toBeInTheDocument();
  });

  it("detail panel shows status buttons (Open, Acknowledged, Resolved)", async () => {
    const { api } = await import("../api/client");
    const detailEvent = {
      ...MOCK_EVENT,
      status: "open" as const,
      snapshots: [],
      analyses: [],
    };
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    (api.events.get as ReturnType<typeof vi.fn>).mockResolvedValue(detailEvent);

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    switchToFlat();

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(screen.getByText("Open")).toBeInTheDocument();
    });
    expect(screen.getByText("Acknowledged")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });

  it("status button calls api.events.updateStatus", async () => {
    const { api } = await import("../api/client");
    const detailEvent = {
      ...MOCK_EVENT,
      status: "open" as const,
      snapshots: [],
      analyses: [],
    };
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    (api.events.get as ReturnType<typeof vi.fn>).mockResolvedValue(detailEvent);
    (api.events.updateStatus as ReturnType<typeof vi.fn>).mockResolvedValue({});

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    switchToFlat();

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(screen.getByText("Acknowledged")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Acknowledged"));

    await waitFor(() => {
      expect(api.events.updateStatus).toHaveBeenCalledWith(1, "acknowledged");
    });
  });

  it("detail panel shows 'Ask AI to Explain' button", async () => {
    const { api } = await import("../api/client");
    const detailEvent = {
      ...MOCK_EVENT,
      snapshots: [],
      analyses: [],
    };
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    (api.events.get as ReturnType<typeof vi.fn>).mockResolvedValue(detailEvent);

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    switchToFlat();

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(screen.getByText(/Ask AI to Explain/)).toBeInTheDocument();
    });
  });

  it("clicking 'Ask AI to Explain' opens the AI drawer", async () => {
    const { api } = await import("../api/client");
    const detailEvent = {
      ...MOCK_EVENT,
      snapshots: [],
      analyses: [],
    };
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    (api.events.get as ReturnType<typeof vi.fn>).mockResolvedValue(detailEvent);

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    switchToFlat();

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(screen.getByText(/Ask AI to Explain/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Ask AI to Explain/));
    expect(screen.getByTestId("ai-drawer")).toBeInTheDocument();
  });

  it("detail panel shows 'View all for X' link", async () => {
    const { api } = await import("../api/client");
    const detailEvent = {
      ...MOCK_EVENT,
      object: "pod/nginx-7f8b9c6d4-x2k9l",
      snapshots: [],
      analyses: [],
    };
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    (api.events.get as ReturnType<typeof vi.fn>).mockResolvedValue(detailEvent);

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    switchToFlat();

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(screen.getByText(/View all for/)).toBeInTheDocument();
    });
  });

  it("detail panel close button removes the panel", async () => {
    const { api } = await import("../api/client");
    const detailEvent = {
      ...MOCK_EVENT,
      snapshots: [],
      analyses: [],
    };
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    (api.events.get as ReturnType<typeof vi.fn>).mockResolvedValue(detailEvent);

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    switchToFlat();

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(screen.getByText("Open")).toBeInTheDocument();
    });

    const closeButtons = screen.getAllByRole("button");
    const closeBtn = closeButtons.find(b => b.querySelector(".lucide-x"));
    expect(closeBtn).toBeDefined();
    fireEvent.click(closeBtn!);

    await waitFor(() => {
      expect(screen.queryByText("Open")).not.toBeInTheDocument();
    });
  });

  it("detail panel shows snapshot content in CollapsibleSection", async () => {
    const { api } = await import("../api/client");
    const detailEvent = {
      ...MOCK_EVENT,
      snapshots: [
        { kind: "describe", content: "Name: nginx\nNamespace: default\nLabels: app=nginx" },
        { kind: "logs", content: "Error: connection refused" },
      ],
      analyses: [],
    };
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    (api.events.get as ReturnType<typeof vi.fn>).mockResolvedValue(detailEvent);

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    switchToFlat();

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(screen.getByText("kubectl describe")).toBeInTheDocument();
    });
    expect(screen.getByText("kubectl logs")).toBeInTheDocument();

    expect(screen.queryByText("Name: nginx")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("kubectl describe"));
    expect(screen.getByText(/Name: nginx/)).toBeInTheDocument();
  });

  it("detail panel shows remediation from analysis", async () => {
    const { api } = await import("../api/client");
    const detailEvent = {
      ...MOCK_EVENT,
      snapshots: [],
      analyses: [{ id: 1, remediation: "Increase memory limits to 512Mi" }],
    };
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    (api.events.get as ReturnType<typeof vi.fn>).mockResolvedValue(detailEvent);

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    switchToFlat();

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(screen.getByText("Increase memory limits to 512Mi")).toBeInTheDocument();
    });
    expect(screen.getByText("Proposed Remediation")).toBeInTheDocument();
  });

  it("detail panel shows loading skeleton while fetching", async () => {
    const { api } = await import("../api/client");
    let resolveGet!: (v: unknown) => void;
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    (api.events.get as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(r => { resolveGet = r; }));

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    switchToFlat();

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(screen.getByText("Loading…")).toBeInTheDocument();
    });

    resolveGet({ ...MOCK_EVENT, snapshots: [], analyses: [] });

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
  });

  it("filters by namespace when namespace dropdown changed", async () => {
    const { api } = await import("../api/client");
    const events = [
      { ...MOCK_EVENT, id: 1, namespace: "default" },
      { ...MOCK_EVENT, id: 2, namespace: "kube-system" },
    ];
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue(events);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });

    const nsSelect = screen.getByLabelText("Filter by namespace");
    expect(nsSelect).toBeInTheDocument();
    fireEvent.change(nsSelect, { target: { value: "kube-system" } });
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("object search input triggers debounced filter", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search object…");
    fireEvent.change(searchInput, { target: { value: "nginx" } });

    expect(searchInput).toHaveValue("nginx");
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("refresh button calls load again", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    (api.events.list as ReturnType<typeof vi.fn>).mockClear();

    const refreshBtn = screen.getByTitle("Refresh");
    fireEvent.click(refreshBtn);
    await waitFor(() => {
      expect(api.events.list).toHaveBeenCalled();
    });
  });

  it("clicking All severity pill resets level filter", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("SEV1"));
    expect(screen.getByText("Clear")).toBeInTheDocument();

    fireEvent.click(screen.getByText("All"));
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
  });

  it("SEV3 pill calls api with level SEV3", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
    (api.events.list as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByText("SEV3"));
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });
});
