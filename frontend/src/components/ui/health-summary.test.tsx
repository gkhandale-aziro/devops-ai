import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { HealthSummaryBar } from "./health-summary";
import type { HealthSummary } from "../../types";

const mockHealth = vi.fn<(id: string) => Promise<HealthSummary>>();

vi.mock("../../api/client", () => ({
  api: {
    health: (...args: unknown[]) => mockHealth(...(args as [string])),
  },
}));

describe("HealthSummaryBar", () => {
  beforeEach(() => {
    mockHealth.mockReset();
  });

  it("shows loading skeleton initially", () => {
    mockHealth.mockReturnValue(new Promise(() => {})); // never resolves
    render(<HealthSummaryBar targetId="t1" refreshMs={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading health data")).toBeInTheDocument();
  });

  it("renders Kubernetes health (pods, deploys, nodes)", async () => {
    mockHealth.mockResolvedValue({
      pods: { running: 10, pending: 2, failed: 1, succeeded: 0, total: 13 },
      deployments: { ready: 4, total: 5 },
      nodes: { ready: 3, total: 3 },
    });

    render(<HealthSummaryBar targetId="t1" refreshMs={null} />);

    await waitFor(() => {
      expect(screen.getByText("Pods")).toBeInTheDocument();
    });

    expect(screen.getByText("10 running")).toBeInTheDocument();
    expect(screen.getByText("2 pending")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getByText("Deploys")).toBeInTheDocument();
    expect(screen.getByText("4 / 5 ready")).toBeInTheDocument();
    expect(screen.getByText("Nodes")).toBeInTheDocument();
    expect(screen.getByText("3 / 3 ready")).toBeInTheDocument();
  });

  it("renders Docker health (containers)", async () => {
    mockHealth.mockResolvedValue({
      containers: { running: 5, stopped: 2, total: 7 },
    });

    render(<HealthSummaryBar targetId="t1" refreshMs={null} />);

    await waitFor(() => {
      expect(screen.getByText("Containers")).toBeInTheDocument();
    });

    expect(screen.getByText("5 running")).toBeInTheDocument();
    expect(screen.getByText("2 stopped")).toBeInTheDocument();
  });

  it("renders SSH/local health (services)", async () => {
    mockHealth.mockResolvedValue({
      services: { active: 120, failed: 3, total: 123 },
    });

    render(<HealthSummaryBar targetId="t1" refreshMs={null} />);

    await waitFor(() => {
      expect(screen.getByText("Services")).toBeInTheDocument();
    });

    expect(screen.getByText("120 active")).toBeInTheDocument();
    expect(screen.getByText("3 failed")).toBeInTheDocument();
  });

  it("hides zero-count items", async () => {
    mockHealth.mockResolvedValue({
      pods: { running: 5, pending: 0, failed: 0, succeeded: 0, total: 5 },
      deployments: { ready: 2, total: 2 },
      nodes: { ready: 1, total: 1 },
    });

    render(<HealthSummaryBar targetId="t1" refreshMs={null} />);

    await waitFor(() => {
      expect(screen.getByText("5 running")).toBeInTheDocument();
    });

    expect(screen.queryByText("0 pending")).not.toBeInTheDocument();
    expect(screen.queryByText("0 failed")).not.toBeInTheDocument();
  });

  it("renders nothing on API error", async () => {
    mockHealth.mockRejectedValue(new Error("network error"));

    const { container } = render(<HealthSummaryBar targetId="t1" refreshMs={null} />);

    // Initially shows skeleton
    expect(screen.getByRole("status")).toBeInTheDocument();

    // After error, renders nothing
    await waitFor(() => {
      expect(container.querySelector("[role='region']")).not.toBeInTheDocument();
      expect(container.querySelector("[role='status']")).not.toBeInTheDocument();
    });
  });

  it("has accessible region landmark", async () => {
    mockHealth.mockResolvedValue({
      pods: { running: 3, pending: 0, failed: 0, succeeded: 0, total: 3 },
    });

    render(<HealthSummaryBar targetId="t1" refreshMs={null} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Workload health")).toBeInTheDocument();
    });
  });

  it("includes succeeded pods when count > 0", async () => {
    mockHealth.mockResolvedValue({
      pods: { running: 3, pending: 0, failed: 0, succeeded: 2, total: 5 },
    });

    render(<HealthSummaryBar targetId="t1" refreshMs={null} />);

    await waitFor(() => {
      expect(screen.getByText("2 succeeded")).toBeInTheDocument();
    });
  });
});
