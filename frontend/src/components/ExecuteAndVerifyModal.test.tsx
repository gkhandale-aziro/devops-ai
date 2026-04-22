import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExecuteAndVerifyModal } from "./ExecuteAndVerifyModal";
import type { StoredEvent, ExecuteResult } from "../types";

vi.mock("../api/client", () => ({
  api: {
    events:  { execute:        vi.fn() },
    targets: { executeResolve: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error:   vi.fn(),
  },
}));

import { api } from "../api/client";
import { toast } from "sonner";

const EVENT: StoredEvent = {
  id:          42,
  timestamp:   "2026-04-22T12:00:00Z",
  source:      "kubelet",
  level:       "SEV1",
  reason:      "CrashLoopBackOff",
  object:      "pod/nginx-abc",
  namespace:   "default",
  message:     "crashed",
  status:      "open",
  target_id:   "t1",
  target_name: "prod-cluster",
  snapshots:   [],
  analyses:    [],
};

function mkResult(overrides: Partial<ExecuteResult> = {}): ExecuteResult {
  return {
    event_id: overrides.event_id ?? 42,
    execution: {
      command:    "kubectl delete pod nginx-abc -n default",
      output:     "pod \"nginx-abc\" deleted",
      timestamp:  "2026-04-22T12:00:01Z",
      duration_s: 1.23,
      ...overrides.execution,
    },
    verification: {
      success:     true,
      reason:      "pod-running",
      predicate:   "pod nginx-abc reaches Running and restart count holds steady",
      attempts:    [{ ts: 1, probe: "kubectl get pod …", output: "Running|0", healthy: true }],
      duration_s:  15.5,
      final_state: "Running|0",
      note:        "healthy for 15s continuously",
      ...overrides.verification,
    },
    final_status: overrides.final_status ?? "resolved",
  };
}

describe("ExecuteAndVerifyModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when closed", () => {
    const { container } = render(
      <ExecuteAndVerifyModal
        open={false}
        mode={{ kind: "event", event: EVENT }}
        initialCommand="kubectl delete pod nginx-abc"
        onClose={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("pre-fills the command textarea from initialCommand", () => {
    render(
      <ExecuteAndVerifyModal
        open
        mode={{ kind: "event", event: EVENT }}
        initialCommand="kubectl delete pod nginx-abc"
        onClose={vi.fn()}
      />
    );
    const textarea = screen.getByLabelText(/kubectl command/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("kubectl delete pod nginx-abc");
  });

  it("rejects an empty command client-side without hitting the API", async () => {
    render(
      <ExecuteAndVerifyModal
        open
        mode={{ kind: "event", event: EVENT }}
        initialCommand=""
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /execute & verify/i }));
    await waitFor(() => expect(screen.getByText(/command is empty/i)).toBeInTheDocument());
    expect(api.events.execute).not.toHaveBeenCalled();
  });

  it("rejects a non-kubectl command client-side", async () => {
    render(
      <ExecuteAndVerifyModal
        open
        mode={{ kind: "event", event: EVENT }}
        initialCommand="rm -rf /"
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /execute & verify/i }));
    await waitFor(() =>
      expect(screen.getByText(/only kubectl commands/i)).toBeInTheDocument()
    );
    expect(api.events.execute).not.toHaveBeenCalled();
  });

  it("renders success banner and calls onCompleted on resolved outcome", async () => {
    const result = mkResult();
    (api.events.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(result);
    const onCompleted = vi.fn();

    render(
      <ExecuteAndVerifyModal
        open
        mode={{ kind: "event", event: EVENT }}
        initialCommand="kubectl delete pod nginx-abc -n default"
        onClose={vi.fn()}
        onCompleted={onCompleted}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /execute & verify/i }));

    await waitFor(() =>
      expect(screen.getByText(/resolved — object healthy/i)).toBeInTheDocument()
    );
    expect(api.events.execute).toHaveBeenCalledWith(42, "kubectl delete pod nginx-abc -n default");
    expect(toast.success).toHaveBeenCalled();
    expect(onCompleted).toHaveBeenCalledWith(result);
  });

  it("renders failure banner when verification fails", async () => {
    const result = mkResult({
      verification: {
        success: false, reason: "pod-running", predicate: "pod healthy",
        attempts: [], duration_s: 60, final_state: "CrashLoopBackOff|3",
        note: "timed out after 60s",
      },
      final_status: "needs_attention",
    });
    (api.events.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(result);

    render(
      <ExecuteAndVerifyModal
        open
        mode={{ kind: "event", event: EVENT }}
        initialCommand="kubectl delete pod nginx-abc"
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /execute & verify/i }));

    await waitFor(() =>
      expect(screen.getByText(/not yet healthy/i)).toBeInTheDocument()
    );
    expect(toast.error).toHaveBeenCalled();
    expect(screen.getByText(/timed out after 60s/i)).toBeInTheDocument();
  });

  it("surfaces backend errors without crashing", async () => {
    (api.events.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("verb not allowed"),
    );

    render(
      <ExecuteAndVerifyModal
        open
        mode={{ kind: "event", event: EVENT }}
        initialCommand="kubectl get pods"
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /execute & verify/i }));

    await waitFor(() =>
      expect(screen.getByText(/verb not allowed/i)).toBeInTheDocument()
    );
  });

  it("target-mode dispatches to targets.executeResolve with the right body", async () => {
    const result = mkResult();
    (api.targets.executeResolve as ReturnType<typeof vi.fn>).mockResolvedValueOnce(result);
    const onCompleted = vi.fn();

    render(
      <ExecuteAndVerifyModal
        open
        mode={{
          kind:       "target",
          targetId:   "t1",
          targetName: "prod-cluster",
          object:     "nginx-abc",
          namespace:  "default",
          reason:     "CrashLoopBackOff",
        }}
        initialCommand="kubectl delete pod nginx-abc -n default"
        onClose={vi.fn()}
        onCompleted={onCompleted}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /execute & verify/i }));

    await waitFor(() =>
      expect(screen.getByText(/resolved — object healthy/i)).toBeInTheDocument()
    );
    expect(api.targets.executeResolve).toHaveBeenCalledWith("t1", {
      object:    "nginx-abc",
      namespace: "default",
      reason:    "CrashLoopBackOff",
      command:   "kubectl delete pod nginx-abc -n default",
    });
    expect(api.events.execute).not.toHaveBeenCalled();
    expect(onCompleted).toHaveBeenCalledWith(result);
  });

  it("target-mode renders the object and target name in the header", () => {
    render(
      <ExecuteAndVerifyModal
        open
        mode={{
          kind:       "target",
          targetId:   "t1",
          targetName: "prod-cluster",
          object:     "nginx-abc",
          namespace:  "default",
          reason:     "CrashLoopBackOff",
        }}
        initialCommand="kubectl delete pod nginx-abc -n default"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/execute & verify — nginx-abc/i)).toBeInTheDocument();
    expect(screen.getByText(/prod-cluster/)).toBeInTheDocument();
  });

  it("disables Cancel while running to prevent half-applied state", async () => {
    let resolve!: (v: ExecuteResult) => void;
    (api.events.execute as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<ExecuteResult>(r => { resolve = r; }),
    );

    render(
      <ExecuteAndVerifyModal
        open
        mode={{ kind: "event", event: EVENT }}
        initialCommand="kubectl delete pod nginx-abc"
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /execute & verify/i }));

    const cancel = await screen.findByRole("button", { name: /cancel/i });
    expect(cancel).toBeDisabled();

    resolve(mkResult());
    await waitFor(() =>
      expect(screen.getByText(/resolved — object healthy/i)).toBeInTheDocument()
    );
  });
});
