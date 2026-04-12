import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TimeRangePicker } from "./time-range-picker";

describe("TimeRangePicker", () => {
  it("renders all 4 range options", () => {
    render(<TimeRangePicker value="1h" onChange={() => {}} />);
    expect(screen.getByText("1h")).toBeInTheDocument();
    expect(screen.getByText("6h")).toBeInTheDocument();
    expect(screen.getByText("24h")).toBeInTheDocument();
    expect(screen.getByText("7d")).toBeInTheDocument();
  });

  it("active button has aria-pressed=true", () => {
    render(<TimeRangePicker value="6h" onChange={() => {}} />);
    expect(screen.getByText("6h")).toHaveAttribute("aria-pressed", "true");
  });

  it("inactive buttons have aria-pressed=false", () => {
    render(<TimeRangePicker value="6h" onChange={() => {}} />);
    expect(screen.getByText("1h")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("24h")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("7d")).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange when clicked", () => {
    const onChange = vi.fn();
    render(<TimeRangePicker value="1h" onChange={onChange} />);
    fireEvent.click(screen.getByText("24h"));
    expect(onChange).toHaveBeenCalledWith("24h");
  });

  it("only one button is active at a time", () => {
    render(<TimeRangePicker value="7d" onChange={() => {}} />);
    const buttons = screen.getAllByRole("button");
    const pressedButtons = buttons.filter(
      (btn) => btn.getAttribute("aria-pressed") === "true"
    );
    expect(pressedButtons).toHaveLength(1);
    expect(pressedButtons[0].textContent).toBe("7d");
  });
});
