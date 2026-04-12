import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

  it("creates new session on + click", async () => {
    const { api } = await import("../api/client");
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByLabelText("New chat"));
    await waitFor(() => {
      expect(api.sessions.create).toHaveBeenCalled();
    });
  });

  it("shows sessions when available", async () => {
    const { api } = await import("../api/client");
    const SESSIONS = [
      { id: "s1", title: "Debug K8s", created: new Date().toISOString() },
      { id: "s2", title: "Deploy help", created: new Date().toISOString() },
    ];
    (api.sessions.list as ReturnType<typeof vi.fn>).mockResolvedValue(SESSIONS);
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Debug K8s")).toBeInTheDocument();
    });
    expect(screen.getByText("Deploy help")).toBeInTheDocument();
  });

  it("switches session on click", async () => {
    const { api } = await import("../api/client");
    const SESSIONS = [
      { id: "s1", title: "Session One", created: new Date().toISOString() },
      { id: "s2", title: "Session Two", created: new Date().toISOString() },
    ];
    (api.sessions.list as ReturnType<typeof vi.fn>).mockResolvedValue(SESSIONS);
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Session Two")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Session Two"));
    // The ChatPanel should be rendered for the active session
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("shows breadcrumb with AI Chat", () => {
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    expect(screen.getByText("AI Chat")).toBeInTheDocument();
  });

  it("shows delete button on active session", async () => {
    const { api } = await import("../api/client");
    const SESSIONS = [
      { id: "s1", title: "My Session", created: new Date().toISOString() },
    ];
    (api.sessions.list as ReturnType<typeof vi.fn>).mockResolvedValue(SESSIONS);
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("My Session")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Delete conversation My Session")).toBeInTheDocument();
  });

  it("auto-selects first session and shows ChatPanel", async () => {
    const { api } = await import("../api/client");
    const SESSIONS = [
      { id: "s1", title: "First Chat", created: new Date().toISOString() },
    ];
    (api.sessions.list as ReturnType<typeof vi.fn>).mockResolvedValue(SESSIONS);
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("First Chat")).toBeInTheDocument();
    });
    // Auto-selects first session, so ChatPanel should render
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    // "No conversation selected" should NOT appear
    expect(screen.queryByText("No conversation selected")).not.toBeInTheDocument();
  });

  it("switches session on click and shows ChatPanel", async () => {
    const { api } = await import("../api/client");
    const SESSIONS = [
      { id: "s1", title: "Chat A", created: new Date().toISOString() },
      { id: "s2", title: "Chat B", created: new Date().toISOString() },
    ];
    (api.sessions.list as ReturnType<typeof vi.fn>).mockResolvedValue(SESSIONS);
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Chat A")).toBeInTheDocument();
      expect(screen.getByText("Chat B")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Chat B"));
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("keyboard Enter switches session", async () => {
    const { api } = await import("../api/client");
    const SESSIONS = [
      { id: "s1", title: "KB Test A", created: new Date().toISOString() },
      { id: "s2", title: "KB Test B", created: new Date().toISOString() },
    ];
    (api.sessions.list as ReturnType<typeof vi.fn>).mockResolvedValue(SESSIONS);
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("KB Test B")).toBeInTheDocument();
    });
    const sessionItem = screen.getByText("KB Test B").closest("[role='button']")!;
    fireEvent.keyDown(sessionItem, { key: "Enter" });
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("keyboard Space switches session", async () => {
    const { api } = await import("../api/client");
    const SESSIONS = [
      { id: "s1", title: "Space A", created: new Date().toISOString() },
      { id: "s2", title: "Space B", created: new Date().toISOString() },
    ];
    (api.sessions.list as ReturnType<typeof vi.fn>).mockResolvedValue(SESSIONS);
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Space B")).toBeInTheDocument();
    });
    const sessionItem = screen.getByText("Space B").closest("[role='button']")!;
    fireEvent.keyDown(sessionItem, { key: " " });
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("delete button opens confirm dialog", async () => {
    const { api } = await import("../api/client");
    const SESSIONS = [
      { id: "s1", title: "To Delete", created: new Date().toISOString() },
    ];
    (api.sessions.list as ReturnType<typeof vi.fn>).mockResolvedValue(SESSIONS);
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("To Delete")).toBeInTheDocument();
    });
    // Click delete button
    fireEvent.click(screen.getByLabelText("Delete conversation To Delete"));
    // ConfirmDialog is mocked, just verify it's present
    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
  });

  it("shows empty sidebar prompt when no sessions", () => {
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/to start your first conversation/i)).toBeInTheDocument();
  });

  it("new session creation adds to list and activates it", async () => {
    const { api } = await import("../api/client");
    (api.sessions.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.sessions.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "new-1",
      title: "New Chat",
      created: new Date().toISOString(),
    });
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByLabelText("New chat"));
    await waitFor(() => {
      expect(api.sessions.create).toHaveBeenCalledWith("New Chat");
    });
    await waitFor(() => {
      expect(screen.getByText("New Chat")).toBeInTheDocument();
    });
    // After creating, ChatPanel should be shown (session is active)
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("shows session list as ul with proper aria label", async () => {
    render(
      <MemoryRouter>
        <Chat targets={[TARGET]} activeTarget={TARGET} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("list", { name: "Chat sessions" })).toBeInTheDocument();
  });
});
