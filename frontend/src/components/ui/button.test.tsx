import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(
      screen.getByRole("button", { name: "Click me" })
    ).toBeInTheDocument();
  });

  it("fires onClick", async () => {
    const fn = vi.fn();
    render(<Button onClick={fn}>Go</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(fn).toHaveBeenCalledOnce();
  });

  it("is disabled when disabled prop set", () => {
    render(<Button disabled>No</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("applies variant classes", () => {
    const { container } = render(<Button variant="destructive">Del</Button>);
    expect(container.firstChild).toHaveClass("bg-destructive");
  });

  it("applies size classes", () => {
    const { container } = render(<Button size="sm">S</Button>);
    expect(container.firstChild).toHaveClass("h-8");
  });

  it("merges custom className", () => {
    const { container } = render(<Button className="mt-4">Custom</Button>);
    expect(container.firstChild).toHaveClass("mt-4");
  });

  it("forwards ref", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>Ref</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
