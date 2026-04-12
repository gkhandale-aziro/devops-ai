import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Chat } from "./Chat";

vi.mock("../api/client", () => ({
  api: {
    sessions: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "s1", title: "New Chat", created: new Date().toISOString() }),
      remove: vi.fn().mockResolvedValue({}),
      messages: vi.fn().mockResolvedValue([]),
    },
    chatStream: vi.fn().mockResolvedValue(new Response()),
    info: vi.fn().mockResolvedValue({ answer_model: "test" }),
  },
  readSSE: vi.fn(),
}));

vi.mock("../hooks/useChatStore", () => ({
  useSessionChat: () => ({
    messages: [],
    loading: false,
    send: vi.fn(),
    retry: vi.fn(),
    edit: vi.fn(),
    clear: vi.fn(),
    load: vi.fn(),
  }),
  deleteSessionStore: vi.fn(),
  setTitleUpdateCallback: vi.fn(),
}));

vi.mock("../components/ChatPanel", () => ({
  ChatPanel: () => <div data-testid="chat-panel">ChatPanel</div>,
}));

vi.mock("../components/confirm-dialog", () => ({
  ConfirmDialog: () => <div data-testid="confirm-dialog" />,
}));

const TARGET = {
  id: "t1",
  name: "test-cluster",
  type: "kubernetes" as const,
  status: "online" as const,
  config: { kubeconfig: "/path" },
};

describe("Chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing", () => {
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    expect(screen.getByText("AI Assistant")).toBeInTheDocument();
  });

  it("shows conversations sidebar header", () => {
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Conversations")).toBeInTheDocument();
  });

  it("shows new chat button", () => {
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("New chat")).toBeInTheDocument();
  });

  it("shows empty state when no sessions", () => {
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    expect(screen.getByText("No conversation selected")).toBeInTheDocument();
  });

  it("shows assistant description text", () => {
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Ask anything about DevOps, infrastructure, or Kubernetes"),
    ).toBeInTheDocument();
  });
});
