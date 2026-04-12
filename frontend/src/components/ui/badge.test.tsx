import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>Status</Badge>);
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("applies default variant", () => {
    const { container } = render(<Badge>Default</Badge>);
    expect(container.firstChild).toHaveClass("text-accent");
  });

  it("applies destructive variant", () => {
    const { container } = render(<Badge variant="destructive">Error</Badge>);
    expect(container.firstChild).toHaveClass("text-destructive");
  });

  it("applies warning variant", () => {
    const { container } = render(<Badge variant="warning">Warn</Badge>);
    expect(container.firstChild).toHaveClass("text-warning");
  });

  it("applies success variant", () => {
    const { container } = render(<Badge variant="success">OK</Badge>);
    expect(container.firstChild).toHaveClass("text-success");
  });

  it("merges custom className", () => {
    const { container } = render(<Badge className="ml-2">Custom</Badge>);
    expect(container.firstChild).toHaveClass("ml-2");
  });
});
