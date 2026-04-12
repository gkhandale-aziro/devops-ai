import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./input";

describe("Input", () => {
  it("renders with placeholder", () => {
    render(<Input placeholder="Search..." />);
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });

  it("accepts user input", async () => {
    render(<Input placeholder="Type" />);
    const input = screen.getByPlaceholderText("Type");
    await userEvent.type(input, "hello");
    expect(input).toHaveValue("hello");
  });

  it("is disabled when disabled prop set", () => {
    render(<Input disabled placeholder="Disabled" />);
    expect(screen.getByPlaceholderText("Disabled")).toBeDisabled();
  });

  it("forwards ref", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("merges custom className", () => {
    const { container } = render(<Input className="mt-4" />);
    expect(container.firstChild).toHaveClass("mt-4");
  });

  it("applies theme-aware base classes", () => {
    const { container } = render(<Input />);
    expect(container.firstChild).toHaveClass("bg-surface");
    expect(container.firstChild).toHaveClass("border-border");
    expect(container.firstChild).toHaveClass("text-foreground");
  });
});
