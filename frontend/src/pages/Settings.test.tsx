import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Settings } from "./Settings";
import { vi } from "vitest";

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

describe("Settings", () => {
  it("renders settings sections", async () => {
    render(<MemoryRouter><Settings targetCount={3} /></MemoryRouter>);
    expect(screen.getByText(/AI Model/i)).toBeInTheDocument();
    expect(screen.getByText(/Appearance/i)).toBeInTheDocument();
    expect(screen.getByText(/Keyboard Shortcuts/i)).toBeInTheDocument();
    expect(screen.getByText(/About/i)).toBeInTheDocument();
  });
});
