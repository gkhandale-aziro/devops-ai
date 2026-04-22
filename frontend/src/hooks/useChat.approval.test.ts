import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useTargetChat } from "./useChat";

// Regression test for CodeRabbit finding on PR #43: when SSE frames arrive
// after `await_approval`, the inline setMessages rewrites at each event
// used to drop the `approval` field, making the Approve/Deny card vanish
// mid-stream. The fix centralizes the update in a patchLastAssistant
// helper that always carries `approval` forward.

type SSEEvent = Record<string, unknown>;

function makeSSEStream(events: SSEEvent[]) {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

vi.mock("../api/client", () => ({
  api: {
    chatStream: vi.fn().mockResolvedValue({ ok: true } as Response),
    approveChatCommand: vi.fn().mockResolvedValue({ ok: true }),
  },
  readSSE: vi.fn(),
}));

import { readSSE } from "../api/client";
const mockReadSSE = readSSE as unknown as ReturnType<typeof vi.fn>;

describe("useTargetChat — approval preservation across SSE frames", () => {
  beforeEach(() => {
    mockReadSSE.mockReset();
  });

  it("keeps approval on the last message when token frames arrive after await_approval", async () => {
    mockReadSSE.mockReturnValue(
      makeSSEStream([
        { t: "I'll " },
        { t: "delete that pod." },
        { await_approval: { approval_id: "abc123", cmd: "kubectl delete pod foo" } },
        // Backend keeps streaming (tool narration, additional tokens) —
        // the approval card must not vanish while these land.
        { t: " Running now." },
        { tool_start: { cmd: "kubectl get pod foo" } },
        { tool_end: { cmd: "kubectl get pod foo", output: "ok", duration_ms: 50, status: "done" } },
      ]),
    );

    const { result } = renderHook(() => useTargetChat("t1"));

    await act(async () => {
      await result.current.send("clean up the broken pod");
    });

    await waitFor(() => {
      const last = result.current.messages[result.current.messages.length - 1];
      expect(last.role).toBe("assistant");
      expect(last.approval).toBeDefined();
      expect(last.approval?.approvalId).toBe("abc123");
      expect(last.approval?.cmd).toBe("kubectl delete pod foo");
      expect(last.approval?.decision).toBeUndefined();
    });
  });

  it("updates approval.decision when approval_decision arrives and keeps later tokens from wiping it", async () => {
    mockReadSSE.mockReturnValue(
      makeSSEStream([
        { await_approval: { approval_id: "abc123", cmd: "kubectl delete pod foo" } },
        { approval_decision: { approval_id: "abc123", decision: "approved" } },
        // Post-decision tokens must not strip the approval field.
        { t: "Pod deleted." },
        { suggestions: ["show events", "re-check pods"] },
      ]),
    );

    const { result } = renderHook(() => useTargetChat("t1"));

    await act(async () => {
      await result.current.send("clean up the broken pod");
    });

    await waitFor(() => {
      const last = result.current.messages[result.current.messages.length - 1];
      expect(last.approval?.decision).toBe("approved");
      expect(last.suggestions).toEqual(["show events", "re-check pods"]);
    });
  });
});
