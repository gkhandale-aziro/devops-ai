import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Settings } from "./Settings";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../api/client", () => ({
  api: {
    models: {
      list: vi.fn().mockResolvedValue({
        ollama: ["llama3", "gemma2"],
        current: { tool_model: "llama3", answer_model: "llama3" },
      }),
      update: vi
        .fn()
        .mockResolvedValue({ tool_model: "gemma2", answer_model: "llama3" }),
      ollamaUrl: {
        get: vi.fn().mockResolvedValue({ url: "http://localhost:11434" }),
        set: vi.fn().mockResolvedValue({ ok: true, error: "", models: 3, url: "http://localhost:11434" }),
      },
    },
    modelHealth: vi.fn().mockResolvedValue({ status: "healthy", primary_tool: "llama3", primary_answer: "llama3", fallback_model: "", error_message: "", since: 0 }),
  },
}));

vi.mock("../components/ThemeContext", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle">ThemeToggle</div>,
}));

vi.mock("../utils/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../components/OnboardingTour", () => ({
  replayOnboardingTour: vi.fn(),
}));

describe("Settings", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { api } = await import("../api/client");
    (api.models.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      ollama: ["llama3", "gemma2"],
      current: { tool_model: "llama3", answer_model: "llama3" },
    });
    (api.modelHealth as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "healthy", primary_tool: "llama3", primary_answer: "llama3", fallback_model: "", error_message: "", since: 0 });
  });

  it("renders settings sections", async () => {
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    expect(screen.getByText(/AI Model/i)).toBeInTheDocument();
    expect(screen.getByText(/Appearance/i)).toBeInTheDocument();
    expect(screen.getByText(/Keyboard Shortcuts/i)).toBeInTheDocument();
    expect(screen.getByText(/About/i)).toBeInTheDocument();
  });

  it("shows loading state initially before models load", async () => {
    // Override mock to return a never-resolving promise
    const { api } = await import("../api/client");
    (api.models.list as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    expect(screen.getByText("Loading models…")).toBeInTheDocument();
  });

  it("shows model dropdowns after loading", async () => {
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.queryByText("Loading models…")).not.toBeInTheDocument();
    });
    // After loading, the model names should appear as select options
    const modelOptions = await screen.findAllByText("llama3");
    expect(modelOptions.length).toBeGreaterThanOrEqual(1);
  });

  it("shows target count in About section", () => {
    render(<MemoryRouter><Settings targetCount={5} /></MemoryRouter>);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText(/Connected targets/i)).toBeInTheDocument();
  });

  it("shows keyboard shortcuts", () => {
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    expect(screen.getByText("Cmd/Ctrl + K")).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();
    expect(screen.getByText("Command palette")).toBeInTheDocument();
    expect(screen.getByText("Close modals / panels")).toBeInTheDocument();
  });

  it("renders theme toggle", () => {
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    expect(screen.getByTestId("theme-toggle")).toBeInTheDocument();
  });

  it("shows Ollama Connection section", () => {
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    expect(screen.getByText("Ollama Connection")).toBeInTheDocument();
    expect(screen.getByText("Save & Test")).toBeInTheDocument();
  });

  it("shows Replay tour button", () => {
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    expect(screen.getByText("Replay tour")).toBeInTheDocument();
  });

  it("shows model health status when healthy", async () => {
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText("Model healthy")).toBeInTheDocument();
    });
  });

  it("shows model select dropdowns after loading and allows model update", async () => {
    const { api } = await import("../api/client");
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.queryByText("Loading models…")).not.toBeInTheDocument();
    });
    // Select dropdowns should be present (tool_model and answer_model)
    const toolSelect = screen.getByLabelText("Tool Model");
    expect(toolSelect).toBeInTheDocument();
    // Change the tool model
    fireEvent.change(toolSelect, { target: { value: "gemma2" } });
    await waitFor(() => {
      expect(api.models.update).toHaveBeenCalledWith({ tool_model: "gemma2" });
    });
  });

  it("updates answer model via select change", async () => {
    const { api } = await import("../api/client");
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.queryByText("Loading models…")).not.toBeInTheDocument();
    });
    const answerSelect = screen.getByLabelText("Answer Model");
    fireEvent.change(answerSelect, { target: { value: "gemma2" } });
    await waitFor(() => {
      expect(api.models.update).toHaveBeenCalledWith({ answer_model: "gemma2" });
    });
  });

  it("shows Ollama URL input and Save & Test button, and handles success", async () => {
    const { api } = await import("../api/client");
    (api.models.ollamaUrl.set as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, error: "", models: 3, url: "http://localhost:11434" });
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);

    const urlInput = screen.getByPlaceholderText("http://localhost:11434");
    expect(urlInput).toBeInTheDocument();

    // Type a URL
    fireEvent.change(urlInput, { target: { value: "http://myhost:11434" } });
    expect(urlInput).toHaveValue("http://myhost:11434");

    // Click Save & Test
    const saveBtn = screen.getByText("Save & Test");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(api.models.ollamaUrl.set).toHaveBeenCalledWith("http://myhost:11434");
    });

    // Success result should appear
    await waitFor(() => {
      expect(screen.getByText(/Connected —/)).toBeInTheDocument();
    });
  });

  it("shows Ollama connection error result", async () => {
    const { api } = await import("../api/client");
    (api.models.ollamaUrl.set as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: "Connection refused", models: 0, url: "" });
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);

    const urlInput = screen.getByPlaceholderText("http://localhost:11434");
    fireEvent.change(urlInput, { target: { value: "http://badhost:11434" } });
    fireEvent.click(screen.getByText("Save & Test"));

    await waitFor(() => {
      expect(screen.getByText("Connection refused")).toBeInTheDocument();
    });
  });

  it("shows Ollama connection error on network exception", async () => {
    const { api } = await import("../api/client");
    (api.models.ollamaUrl.set as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network timeout"));
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);

    const urlInput = screen.getByPlaceholderText("http://localhost:11434");
    fireEvent.change(urlInput, { target: { value: "http://timeout:11434" } });
    fireEvent.click(screen.getByText("Save & Test"));

    await waitFor(() => {
      expect(screen.getByText("Network timeout")).toBeInTheDocument();
    });
  });

  it("shows fallback status banner when model health is fallback", async () => {
    const { api } = await import("../api/client");
    (api.modelHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "fallback",
      primary_tool: "llama3",
      primary_answer: "llama3",
      fallback_model: "gemma2",
      error_message: "",
      since: 0,
    });
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/Quota exhausted/)).toBeInTheDocument();
    });
    expect(screen.getByText(/using fallback/)).toBeInTheDocument();
    // "gemma2" appears both in the fallback banner and as a dropdown option,
    // so check that the banner text contains it
    expect(screen.getByText(/using fallback:/).textContent).toContain("gemma2");
  });

  it("shows exhausted status banner when model health is exhausted", async () => {
    const { api } = await import("../api/client");
    (api.modelHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "exhausted",
      primary_tool: "llama3",
      primary_answer: "llama3",
      fallback_model: "",
      error_message: "",
      since: 0,
    });
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/Quota exhausted/)).toBeInTheDocument();
    });
    expect(screen.getByText(/AI features unavailable/)).toBeInTheDocument();
  });

  it("shows ModelInput when ollamaModels is empty (no Ollama models available)", async () => {
    const { api } = await import("../api/client");
    (api.models.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      ollama: [],
      current: { tool_model: "gemini/gemini-2.5-flash", answer_model: "gemini/gemini-2.5-flash" },
    });
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.queryByText("Loading models…")).not.toBeInTheDocument();
    });
    // When no ollama models, ModelInput text inputs are shown instead of select
    const toolInput = screen.getByLabelText("Tool Model");
    expect(toolInput.tagName).toBe("INPUT");
    expect(toolInput).toHaveValue("gemini/gemini-2.5-flash");
  });

  it("ModelInput submits on Enter key", async () => {
    const { api } = await import("../api/client");
    (api.models.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      ollama: [],
      current: { tool_model: "old-model", answer_model: "old-model" },
    });
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.queryByText("Loading models…")).not.toBeInTheDocument();
    });
    const toolInput = screen.getByLabelText("Tool Model");
    fireEvent.change(toolInput, { target: { value: "new-model" } });
    fireEvent.keyDown(toolInput, { key: "Enter" });
    await waitFor(() => {
      expect(api.models.update).toHaveBeenCalledWith({ tool_model: "new-model" });
    });
  });

  it("Replay tour button calls replayOnboardingTour", async () => {
    const { replayOnboardingTour } = await import("../components/OnboardingTour");
    const { toast } = await import("../utils/toast");
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    fireEvent.click(screen.getByText("Replay tour"));
    expect(replayOnboardingTour).toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Starting tour…");
  });

  it("shows error toast when models.list fails", async () => {
    const { api } = await import("../api/client");
    const { toast } = await import("../utils/toast");
    (api.models.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to load AI models");
    });
  });

  it("shows error toast when model update fails", async () => {
    const { api } = await import("../api/client");
    const { toast } = await import("../utils/toast");
    (api.models.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.queryByText("Loading models…")).not.toBeInTheDocument();
    });
    const toolSelect = screen.getByLabelText("Tool Model");
    fireEvent.change(toolSelect, { target: { value: "gemma2" } });
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to update model");
    });
  });

  it("Ollama URL input Enter key triggers saveOllamaUrl", async () => {
    const { api } = await import("../api/client");
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    const urlInput = screen.getByPlaceholderText("http://localhost:11434");
    fireEvent.change(urlInput, { target: { value: "http://enter-test:11434" } });
    fireEvent.keyDown(urlInput, { key: "Enter" });
    await waitFor(() => {
      expect(api.models.ollamaUrl.set).toHaveBeenCalledWith("http://enter-test:11434");
    });
  });
});
