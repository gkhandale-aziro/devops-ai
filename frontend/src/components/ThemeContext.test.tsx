import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme, ThemeToggle } from "./ThemeContext";

function ThemeReader() {
  const { theme } = useTheme();
  return <div data-testid="theme">{theme}</div>;
}

function ToggleWrapper() {
  return (
    <ThemeProvider>
      <ThemeReader />
      <ThemeToggle />
    </ThemeProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeContext", () => {
  it("defaults to night theme", () => {
    render(
      <ThemeProvider>
        <ThemeReader />
      </ThemeProvider>
    );
    expect(screen.getByTestId("theme").textContent).toBe("night");
  });

  it("persists theme choice to localStorage", async () => {
    const user = userEvent.setup();
    render(<ToggleWrapper />);
    await user.click(screen.getByRole("button", { name: /day mode/i }));
    expect(screen.getByTestId("theme").textContent).toBe("day");
    expect(localStorage.getItem("aziro-theme")).toBe("day");
  });

  it("restores theme from localStorage", () => {
    localStorage.setItem("aziro-theme", "day");
    render(
      <ThemeProvider>
        <ThemeReader />
      </ThemeProvider>
    );
    expect(screen.getByTestId("theme").textContent).toBe("day");
  });

  it("applies 'day' data-theme to html when day theme active", () => {
    localStorage.setItem("aziro-theme", "day");
    render(
      <ThemeProvider>
        <ThemeReader />
      </ThemeProvider>
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("day");
  });

  it("applies 'night' data-theme to html when night theme active", () => {
    render(
      <ThemeProvider>
        <ThemeReader />
      </ThemeProvider>
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("night");
  });

  it("renders toggle with sun/moon icons", () => {
    render(<ToggleWrapper />);
    expect(screen.getByRole("button", { name: /day mode|night mode/i })).toBeInTheDocument();
  });
});
