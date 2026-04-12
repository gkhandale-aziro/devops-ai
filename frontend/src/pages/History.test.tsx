import { render, screen } from "@testing-library/react";
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
  DataTable: () => <div data-testid="data-table">DataTable</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
}));

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
});
