import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Dashboard } from "./Dashboard";

vi.mock("../api/client", () => ({
  api: {
    tab: vi.fn().mockResolvedValue({ pods: "", nodes: "", output: "" }),
    namespaces: vi.fn().mockResolvedValue([]),
    chatStream: vi.fn().mockResolvedValue(new Response()),
    info: vi.fn().mockResolvedValue({ answer_model: "test" }),
  },
  readSSE: vi.fn(),
}));

vi.mock("../hooks/useChat", () => ({
  useTargetChat: () => ({
    messages: [],
    loading: false,
    send: vi.fn(),
    retry: vi.fn(),
    edit: vi.fn(),
    clear: vi.fn(),
  }),
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

const TARGET = {
  id: "t1",
  name: "test-cluster",
  type: "kubernetes" as const,
  status: "online" as const,
  config: { kubeconfig: "/path" },
};

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders empty state when target is null", () => {
    render(
      <MemoryRouter>
        <Dashboard target={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Connect your first target")).toBeInTheDocument();
  });

  it("renders with a target and shows target name", () => {
    render(
      <MemoryRouter>
        <Dashboard target={TARGET} />
      </MemoryRouter>,
    );
    expect(screen.getByText("test-cluster")).toBeInTheDocument();
    expect(screen.getByText("kubernetes")).toBeInTheDocument();
  });

  it("shows the AI Chat tab button", () => {
    render(
      <MemoryRouter>
        <Dashboard target={TARGET} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("tab", { name: /AI Chat/i })).toBeInTheDocument();
  });

  it("shows the Topology tab for kubernetes targets", () => {
    render(
      <MemoryRouter>
        <Dashboard target={TARGET} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("tab", { name: /Topology/i })).toBeInTheDocument();
  });
});
