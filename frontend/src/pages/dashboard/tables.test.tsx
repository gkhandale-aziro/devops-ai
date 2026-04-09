/**
 * tables.test.tsx — smoke tests for KubectlTable.
 *
 * NodeTable, PodTable, ResourceModal, LogsTab all hit the network via the
 * api client and would need it mocked to test in isolation. KubectlTable is
 * the pure rendering primitive that the tab components use heavily and is
 * the highest-leverage thing to lock down here.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KubectlTable } from "./tables";

const SAMPLE_PODS = `NAMESPACE     NAME            READY   STATUS    RESTARTS   AGE
default       web-1           1/1     Running   0          3d
default       web-2           0/1     Pending   2          1h
kube-system   coredns-abc     1/1     Running   0          10d`;

describe("KubectlTable", () => {
  it("renders headers and rows from kubectl output", () => {
    render(<KubectlTable raw={SAMPLE_PODS} />);
    // parseKubectl normalises headers to Title Case
    expect(screen.getByRole("columnheader", { name: "Namespace" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByText("web-1")).toBeInTheDocument();
    expect(screen.getByText("coredns-abc")).toBeInTheDocument();
  });

  it("shows fallback for empty input", () => {
    render(<KubectlTable raw="" />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("shows the raw error string when output starts with TIMEOUT/ERROR/etc", () => {
    render(<KubectlTable raw="[TIMEOUT] kubectl took too long" />);
    expect(screen.getByText(/TIMEOUT/)).toBeInTheDocument();
  });

  it("applies colorFn-derived styling to matching cells", () => {
    const colorFn = (val: string, col: string) =>
      col === "Status" && val === "Running" ? "#22c55e" : null;
    const { container } = render(<KubectlTable raw={SAMPLE_PODS} colorFn={colorFn} />);
    // The colored cells render their value inside a span with the color
    const greenSpans = container.querySelectorAll('span[style*="rgb(34, 197, 94)"]');
    expect(greenSpans.length).toBe(2); // two Running pods
  });

  it("invokes onRowClick with the row's columns and headers", () => {
    const onRowClick = vi.fn();
    render(<KubectlTable raw={SAMPLE_PODS} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText("web-1"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    const [cols, headers] = onRowClick.mock.calls[0];
    expect(headers).toEqual(["Namespace", "Name", "Ready", "Status", "Restarts", "Age"]);
    expect(cols[1]).toBe("web-1");
  });

  it("activates row click via Enter key (a11y)", () => {
    const onRowClick = vi.fn();
    render(<KubectlTable raw={SAMPLE_PODS} onRowClick={onRowClick} />);
    const row = screen.getByText("web-2").closest("tr")!;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("does not make rows interactive when onRowClick is omitted", () => {
    render(<KubectlTable raw={SAMPLE_PODS} />);
    const row = screen.getByText("web-1").closest("tr")!;
    expect(row.getAttribute("tabindex")).toBeNull();
  });
});
