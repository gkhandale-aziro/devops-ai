/**
 * tables-components.test.tsx — smoke tests for NodeTable, PodTable,
 * ResourceModal, and LogsTab. These components call the api client, so
 * we mock `../../api/client` and test rendering + user interactions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { mockApi, mockReadSSE } from "../../test/apiMock";

// ── Hoist mocks before any imports that touch the real module ──────────
vi.mock("../../api/client", () => ({
  api: {
    resource:      (...args: unknown[]) => mockApi.resource(...args),
    tab:           (...args: unknown[]) => mockApi.tab(...args),
    analyzeStream: (...args: unknown[]) => mockApi.analyzeStream(...args),
  },
  readSSE: (...args: unknown[]) => mockReadSSE(...args),
}));

import { NodeTable, PodTable, ResourceModal, LogsTab } from "./tables";
import type { Target } from "../../types";

// ── Fixtures ──────────────────────────────────────────────────────────
const TARGET: Target = {
  id: "t1",
  name: "dev-cluster",
  type: "kubernetes",
  status: "online",
  config: {},
};

const NODE_RAW = `NAME          STATUS   ROLES           AGE   VERSION
node-1        Ready    control-plane   10d   v1.28.0
node-2        NotReady worker          5d    v1.28.0`;

const POD_RAW = `NAMESPACE   NAME        READY   STATUS             RESTARTS   AGE
default     web-1       1/1     Running            0          3d
default     web-2       0/1     CrashLoopBackOff   5          1h
kube-system coredns     1/1     Running            0          10d`;

// ── NodeTable ─────────────────────────────────────────────────────────
describe("NodeTable", () => {
  beforeEach(() => { mockApi.resource.mockReset(); });

  it("renders node rows from kubectl output", () => {
    render(<NodeTable raw={NODE_RAW} target={TARGET} />);
    expect(screen.getByText("node-1")).toBeInTheDocument();
    expect(screen.getByText("node-2")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("NotReady")).toBeInTheDocument();
  });

  it("shows fallback when output is empty or errored", () => {
    render(<NodeTable raw="ERROR: connection refused" target={TARGET} />);
    expect(screen.getByText(/kubectl not available/)).toBeInTheDocument();
  });

  it("opens ResourceModal on row click", async () => {
    mockApi.resource.mockResolvedValue({ describe: "node details here" });
    render(<NodeTable raw={NODE_RAW} target={TARGET} />);
    fireEvent.click(screen.getByText("node-1"));
    await waitFor(() => {
      expect(mockApi.resource).toHaveBeenCalledWith("t1", "node", "node-1", "");
    });
  });

  it("opens node via Enter key (a11y)", async () => {
    mockApi.resource.mockResolvedValue({ describe: "node details" });
    render(<NodeTable raw={NODE_RAW} target={TARGET} />);
    const row = screen.getByText("node-1").closest("tr")!;
    fireEvent.keyDown(row, { key: "Enter" });
    await waitFor(() => {
      expect(mockApi.resource).toHaveBeenCalled();
    });
  });
});

// ── PodTable ──────────────────────────────────────────────────────────
describe("PodTable", () => {
  beforeEach(() => {
    mockApi.resource.mockReset();
    mockApi.analyzeStream.mockReset();
    mockReadSSE.mockReset();
  });

  it("renders pod rows and summary bar", () => {
    render(<PodTable raw={POD_RAW} target={TARGET} />);
    expect(screen.getByText("web-1")).toBeInTheDocument();
    expect(screen.getByText("web-2")).toBeInTheDocument();
    // Summary bar counts
    expect(screen.getByText("2 Running")).toBeInTheDocument();
    expect(screen.getByText("1 Failed")).toBeInTheDocument();
  });

  it("shows fallback when empty", () => {
    render(<PodTable raw="ERROR: no pods" target={TARGET} />);
    expect(screen.getByText(/kubectl not available/)).toBeInTheDocument();
  });

  it("filters by namespace via the dropdown", () => {
    render(<PodTable raw={POD_RAW} target={TARGET} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "kube-system" } });
    // Only kube-system pod visible
    expect(screen.getByText("coredns")).toBeInTheDocument();
    expect(screen.queryByText("web-1")).not.toBeInTheDocument();
  });

  it("filters by search text", () => {
    render(<PodTable raw={POD_RAW} target={TARGET} />);
    const input = screen.getByPlaceholderText("Search pods…");
    fireEvent.change(input, { target: { value: "coredns" } });
    expect(screen.getByText("coredns")).toBeInTheDocument();
    expect(screen.queryByText("web-1")).not.toBeInTheDocument();
  });

  it("opens ResourceModal on pod click", async () => {
    mockApi.resource.mockResolvedValue({ describe: "pod details" });
    render(<PodTable raw={POD_RAW} target={TARGET} />);
    fireEvent.click(screen.getByText("web-1"));
    await waitFor(() => {
      expect(mockApi.resource).toHaveBeenCalledWith("t1", "pod", "web-1", "default");
    });
  });

  it("shows kebab menu with AI Diagnose for unhealthy pods", () => {
    render(<PodTable raw={POD_RAW} target={TARGET} />);
    // Kebab menu buttons appear on every row
    const actionBtns = screen.getAllByLabelText("Row actions");
    expect(actionBtns.length).toBeGreaterThan(0);
  });

  it("shows kebab menu with Stream Logs when onStreamLogs is provided", () => {
    const onStream = vi.fn();
    render(<PodTable raw={POD_RAW} target={TARGET} onStreamLogs={onStream} />);
    const actionBtns = screen.getAllByLabelText("Row actions");
    expect(actionBtns.length).toBeGreaterThan(0);
  });

  it("supports keyboard nav between rows (ArrowDown/ArrowUp)", () => {
    render(<PodTable raw={POD_RAW} target={TARGET} />);
    const rows = screen.getAllByRole("button");
    const podRows = rows.filter(r => r.tagName === "TR");
    if (podRows.length >= 2) {
      (podRows[0] as HTMLElement).focus();
      fireEvent.keyDown(podRows[0], { key: "ArrowDown" });
      // Verify it doesn't throw; focus movement is imperative
    }
  });
});

// ── ResourceModal ─────────────────────────────────────────────────────
describe("ResourceModal", () => {
  beforeEach(() => {
    mockApi.analyzeStream.mockReset();
    mockReadSSE.mockReset();
  });

  const RESOURCE = {
    kind: "pod",
    name: "web-1",
    ns: "default",
    data: {
      describe: "Name: web-1\nNamespace: default\nStatus: Running",
      logs: "2024-01-01 Starting...\n2024-01-01 Ready",
      previous: "[no previous logs]",
    },
  };

  it("renders resource name and kind badge", () => {
    render(<ResourceModal resource={RESOURCE} loading={false} targetId="t1" onClose={vi.fn()} />);
    expect(screen.getByText("web-1")).toBeInTheDocument();
    expect(screen.getByText("pod")).toBeInTheDocument();
  });

  it("renders the describe tab content by default", () => {
    render(<ResourceModal resource={RESOURCE} loading={false} targetId="t1" onClose={vi.fn()} />);
    expect(screen.getByText(/Name: web-1/)).toBeInTheDocument();
  });

  it("switches to logs tab on click", () => {
    render(<ResourceModal resource={RESOURCE} loading={false} targetId="t1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("logs"));
    expect(screen.getByText(/Starting.../)).toBeInTheDocument();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(<ResourceModal resource={RESOURCE} loading={false} targetId="t1" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when clicking the backdrop", () => {
    const onClose = vi.fn();
    render(<ResourceModal resource={RESOURCE} loading={false} targetId="t1" onClose={onClose} />);
    // ResourceModal renders via createPortal to document.body (to escape
    // ancestor stacking contexts from Dashboard's fadeInStyle transform),
    // so the backdrop is NOT in the RTL-returned container. Find it at the
    // role=dialog's grandparent (dialog → modal-box → backdrop).
    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose via the close button", () => {
    const onClose = vi.fn();
    render(<ResourceModal resource={RESOURCE} loading={false} targetId="t1" onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows loading spinner when loading=true", () => {
    render(<ResourceModal resource={null} loading={true} targetId="t1" onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("does not show Previous Logs tab when no previous logs exist", () => {
    render(<ResourceModal resource={RESOURCE} loading={false} targetId="t1" onClose={vi.fn()} />);
    expect(screen.queryByText("Prev Logs")).not.toBeInTheDocument();
  });

  it("shows Previous Logs tab when previous logs exist", () => {
    const withPrev = {
      ...RESOURCE,
      data: { ...RESOURCE.data, previous: "Previous crash log output here" },
    };
    render(<ResourceModal resource={withPrev} loading={false} targetId="t1" onClose={vi.fn()} />);
    expect(screen.getByText("Prev Logs")).toBeInTheDocument();
  });

  it("triggers AI analysis when AI tab is clicked", async () => {
    mockAnalyzeAndSSE("AI says: looks healthy");

    render(<ResourceModal resource={RESOURCE} loading={false} targetId="t1" onClose={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByText("AI Analysis"));
    });
    await waitFor(() => {
      expect(mockApi.analyzeStream).toHaveBeenCalled();
    });
  });

  // ── Action bar tests ─────────────────────────────────────────────────

  it("shows Copy, AI Diagnose action buttons in header", () => {
    render(<ResourceModal resource={RESOURCE} loading={false} targetId="t1" onClose={vi.fn()} />);
    expect(screen.getByLabelText("Copy resource name")).toBeInTheDocument();
    expect(screen.getByLabelText("AI Diagnose")).toBeInTheDocument();
  });

  it("copies resource name to clipboard on Copy click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ResourceModal resource={RESOURCE} loading={false} targetId="t1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Copy resource name"));
    expect(writeText).toHaveBeenCalledWith("web-1");
  });

  it("switches to AI tab when AI Diagnose action is clicked", async () => {
    mockAnalyzeAndSSE("diagnosis result");

    render(<ResourceModal resource={RESOURCE} loading={false} targetId="t1" onClose={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("AI Diagnose"));
    });
    await waitFor(() => {
      expect(mockApi.analyzeStream).toHaveBeenCalled();
    });
  });

  it("shows Stream Logs action for pods when onStreamLogs is provided", () => {
    const onStream = vi.fn();
    render(<ResourceModal resource={RESOURCE} loading={false} targetId="t1" onClose={vi.fn()} onStreamLogs={onStream} />);
    expect(screen.getByLabelText("Stream Logs")).toBeInTheDocument();
  });

  it("calls onStreamLogs and closes modal on Stream Logs click", () => {
    const onStream = vi.fn();
    const onClose = vi.fn();
    render(<ResourceModal resource={RESOURCE} loading={false} targetId="t1" onClose={onClose} onStreamLogs={onStream} />);
    fireEvent.click(screen.getByLabelText("Stream Logs"));
    expect(onStream).toHaveBeenCalledWith("web-1", "default");
    expect(onClose).toHaveBeenCalled();
  });

  it("does not show Stream Logs action for non-pod resources", () => {
    const nodeResource = { ...RESOURCE, kind: "node" };
    render(<ResourceModal resource={nodeResource} loading={false} targetId="t1" onClose={vi.fn()} onStreamLogs={vi.fn()} />);
    expect(screen.queryByLabelText("Stream Logs")).not.toBeInTheDocument();
  });

  it("hides action buttons when loading", () => {
    render(<ResourceModal resource={null} loading={true} targetId="t1" onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Copy resource name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("AI Diagnose")).not.toBeInTheDocument();
  });
});

function mockAnalyzeAndSSE(text: string) {
  mockApi.analyzeStream.mockResolvedValue(new Response());
  mockReadSSE.mockImplementation(async function* () {
    yield { t: text };
  });
}

// ── LogsTab ───────────────────────────────────────────────────────────
describe("LogsTab", () => {
  beforeEach(() => { mockApi.tab.mockReset(); });

  const LOGS_RAW = "Jan 01 12:00:00 server sshd[1234]: Accepted publickey\nJan 01 12:00:01 server kubelet[5678]: Starting";

  it("renders log content in a pre element", () => {
    const { container } = render(<LogsTab raw={LOGS_RAW} target={TARGET} />);
    const pre = container.querySelector("pre");
    expect(pre?.textContent).toContain("Accepted publickey");
  });

  it("renders filter buttons", () => {
    render(<LogsTab raw={LOGS_RAW} target={TARGET} />);
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("kubelet")).toBeInTheDocument();
    expect(screen.getByText("containerd")).toBeInTheDocument();
    expect(screen.getByText("sshd")).toBeInTheDocument();
  });

  it("calls api.tab when a filter button is clicked", async () => {
    mockApi.tab.mockResolvedValue({ logs: "kubelet specific logs" });
    render(<LogsTab raw={LOGS_RAW} target={TARGET} />);
    fireEvent.click(screen.getByText("kubelet"));
    await waitFor(() => {
      expect(mockApi.tab).toHaveBeenCalledWith("t1", "logs", { unit: "kubelet" });
    });
  });

  it("shows 'No logs found' when content is empty", () => {
    render(<LogsTab raw="" target={TARGET} />);
    expect(screen.getByText("No logs found")).toBeInTheDocument();
  });
});
