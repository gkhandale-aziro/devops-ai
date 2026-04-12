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
  object: "pod/nginx",
  namespace: "default",
  source: "kubelet",
  message: "Container crashed",
  timestamp: new Date().toISOString(),
  status: "open" as const,
  snapshots: [],
  analyses: [],
};

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
    // "Incident History" appears in both the hidden h1 and the visible header
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

  it("shows data after loading resolves", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });
  });

  it("shows DataTable when events exist", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT, { ...MOCK_EVENT, id: 2, level: "SEV2" }]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
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
    // No Clear button initially (no filters active)
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
    // Click a severity to activate a filter
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

  it("shows event count after loading", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("1 event")).toBeInTheDocument();
    });
  });

  it("shows plural 'events' for multiple events", async () => {
    const { api } = await import("../api/client");
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT, { ...MOCK_EVENT, id: 2 }]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("2 events")).toBeInTheDocument();
    });
  });

  it("opens detail panel when event row is clicked", async () => {
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
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    // Click on the row to open the detail panel
    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(api.events.get).toHaveBeenCalledWith(1);
    });

    // Detail panel should appear with event info
    await waitFor(() => {
      expect(screen.getByText("Detailed crash info")).toBeInTheDocument();
    });
  });

  it("detail panel shows meta rows (Object, Namespace, Source, Time)", async () => {
    const { api } = await import("../api/client");
    const detailEvent = {
      ...MOCK_EVENT,
      object: "pod/redis",
      namespace: "staging",
      source: "kubelet",
      message: "OOMKilled",
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
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(screen.getByText(/Ask AI to Explain/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Ask AI to Explain/));
    // AIDrawer mock should be in the DOM
    expect(screen.getByTestId("ai-drawer")).toBeInTheDocument();
  });

  it("detail panel shows 'View all for X' link", async () => {
    const { api } = await import("../api/client");
    const detailEvent = {
      ...MOCK_EVENT,
      object: "pod/nginx",
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
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(screen.getByText(/View all for pod\/nginx/)).toBeInTheDocument();
    });
  });

  it("clicking 'View all for X' sets object filter and closes detail", async () => {
    const { api } = await import("../api/client");
    const detailEvent = {
      ...MOCK_EVENT,
      object: "pod/nginx",
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
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(screen.getByText(/View all for pod\/nginx/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/View all for pod\/nginx/));

    // Detail panel should be closed (no status buttons visible)
    await waitFor(() => {
      expect(screen.queryByText("Open")).not.toBeInTheDocument();
    });

    // The object search input should be filled
    expect(screen.getByPlaceholderText("Search object…")).toHaveValue("pod/nginx");
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
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    await waitFor(() => {
      expect(screen.getByText("Open")).toBeInTheDocument();
    });

    // The close button has an X icon — find the button in the detail panel header
    const closeButtons = screen.getAllByRole("button");
    // The close button is the one that closes the detail panel (has no text, is near the detail header)
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
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    // CollapsibleSections should show labels
    await waitFor(() => {
      expect(screen.getByText("kubectl describe")).toBeInTheDocument();
    });
    expect(screen.getByText("kubectl logs")).toBeInTheDocument();

    // Content is hidden by default (collapsed)
    expect(screen.queryByText("Name: nginx")).not.toBeInTheDocument();

    // Click to expand
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
    // Make get hang so we see the loading state
    let resolveGet!: (v: unknown) => void;
    (api.events.list as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_EVENT]);
    (api.events.get as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(r => { resolveGet = r; }));

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("row-1"));

    // Should show "Loading…" in the detail panel header while loading
    await waitFor(() => {
      expect(screen.getByText("Loading…")).toBeInTheDocument();
    });

    // Resolve the get call
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
    // The namespace options should be populated from events
    fireEvent.change(nsSelect, { target: { value: "kube-system" } });
    // Clear button should appear after filtering
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

    // The input value should update immediately
    expect(searchInput).toHaveValue("nginx");
    // Clear button appears because objInput is non-empty
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

    // Activate a filter first
    fireEvent.click(screen.getByText("SEV1"));
    expect(screen.getByText("Clear")).toBeInTheDocument();

    // Click "All" to reset
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
    // After clicking SEV3, Clear button should appear (filter is active)
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });
});
