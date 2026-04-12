import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Home } from "./Home";

vi.mock("../api/client", () => ({
  api: {
    events: { list: vi.fn().mockResolvedValue([]) },
    stats: vi.fn().mockResolvedValue({ counts: {} }),
  },
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
});
