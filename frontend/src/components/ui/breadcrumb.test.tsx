import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Breadcrumb } from "./breadcrumb";
import { Bell, Clock } from "lucide-react";

function renderWithRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("Breadcrumb", () => {
  it("renders all item labels", () => {
    renderWithRouter(
      <Breadcrumb items={[
        { label: "Home", href: "/" },
        { label: "Dashboard", href: "/dashboard" },
        { label: "dev-cluster" },
      ]} />
    );
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("dev-cluster")).toBeInTheDocument();
  });

  it("renders last item without a link", () => {
    renderWithRouter(
      <Breadcrumb items={[
        { label: "Home", href: "/" },
        { label: "Settings" },
      ]} />
    );
    // Last item is a span, not a link
    const settings = screen.getByText("Settings");
    expect(settings.tagName).toBe("SPAN");
    expect(settings.closest("a")).toBeNull();
  });

  it("renders non-last items with href as links", () => {
    renderWithRouter(
      <Breadcrumb items={[
        { label: "Home", href: "/" },
        { label: "Current Page" },
      ]} />
    );
    const homeLink = screen.getByText("Home").closest("a");
    expect(homeLink).not.toBeNull();
    expect(homeLink!.getAttribute("href")).toBe("/");
  });

  it("renders ChevronRight separators between items", () => {
    const { container } = renderWithRouter(
      <Breadcrumb items={[
        { label: "Home", href: "/" },
        { label: "Alerts", href: "/alerts" },
        { label: "Detail" },
      ]} />
    );
    // 3 items → 2 chevron separators (svg elements)
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(2);
  });

  it("renders icons when provided", () => {
    renderWithRouter(
      <Breadcrumb items={[
        { label: "Home", href: "/" },
        { label: "Live Alerts", icon: <Bell size={14} data-testid="bell-icon" /> },
      ]} />
    );
    expect(screen.getByTestId("bell-icon")).toBeInTheDocument();
  });

  it("renders a single item without separator", () => {
    const { container } = renderWithRouter(
      <Breadcrumb items={[{ label: "Home" }]} />
    );
    // No chevron separators
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(0);
  });

  it("has accessible nav landmark", () => {
    renderWithRouter(
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Page" }]} />
    );
    expect(screen.getByLabelText("Breadcrumb")).toBeInTheDocument();
  });

  it("renders items without href as spans (not links) even in middle", () => {
    renderWithRouter(
      <Breadcrumb items={[
        { label: "Home", href: "/" },
        { label: "No Link" },
        { label: "Current" },
      ]} />
    );
    const noLink = screen.getByText("No Link");
    expect(noLink.tagName).toBe("SPAN");
    expect(noLink.closest("a")).toBeNull();
  });

  it("renders icon on last (current) item with accent color", () => {
    renderWithRouter(
      <Breadcrumb items={[
        { label: "Home", href: "/" },
        { label: "History", icon: <Clock size={14} data-testid="clock-icon" /> },
      ]} />
    );
    const iconWrapper = screen.getByTestId("clock-icon").parentElement!;
    expect(iconWrapper.style.color).toBe("var(--c-accent-hover)");
  });
});
