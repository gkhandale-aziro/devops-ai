import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: any) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => <div data-testid="area" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  Tooltip: () => <div data-testid="tooltip" />,
  ReferenceLine: () => <div data-testid="reference-line" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
}));

import { MetricChart, MiniSpark } from "./metric-chart";

describe("MetricChart", () => {
  it("shows 'Waiting for data...' when data is empty", () => {
    render(<MetricChart data={[]} label="CPU Usage" />);
    expect(screen.getByText(/Waiting for data/)).toBeInTheDocument();
  });

  it("renders chart container when data provided", () => {
    const data = [
      { t: "2026-01-01T00:00:00Z", v: 10 },
      { t: "2026-01-01T01:00:00Z", v: 20 },
    ];
    render(<MetricChart data={data} label="CPU Usage" />);
    expect(screen.getByRole("img", { name: "CPU Usage chart" })).toBeInTheDocument();
    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    expect(screen.getByTestId("area-chart")).toBeInTheDocument();
  });

  it("renders with custom height", () => {
    const data = [{ t: "2026-01-01T00:00:00Z", v: 10 }];
    const { container } = render(
      <MetricChart data={data} label="Memory" height={300} />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.height).toBe("300px");
  });

  it("does not render chart elements when data is empty", () => {
    render(<MetricChart data={[]} label="CPU" />);
    expect(screen.queryByTestId("area-chart")).not.toBeInTheDocument();
  });
});

describe("MiniSpark", () => {
  it("renders sparkline container", () => {
    const { container } = render(
      <MiniSpark data={[1, 2, 3, 4, 5]} color="#4f46e5" />
    );
    expect(container.firstChild).toBeTruthy();
    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
  });

  it("renders with custom width and height", () => {
    const { container } = render(
      <MiniSpark data={[10, 20, 30]} color="#22c55e" width={120} height={40} />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe("120px");
    expect(wrapper.style.height).toBe("40px");
  });
});
