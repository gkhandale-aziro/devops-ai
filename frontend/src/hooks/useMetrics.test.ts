import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useMetrics } from "./useMetrics";

vi.mock("../api/client", () => ({
  api: {
    metrics: vi.fn(),
  },
}));

import { api } from "../api/client";
const mockMetrics = api.metrics as ReturnType<typeof vi.fn>;

/**
 * Helper: flush pending microtasks (resolved promises) without
 * advancing macro-timers (setInterval). We advance timers by 0ms
 * which only triggers already-scheduled microtasks.
 */
async function flushMicrotasks() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useMetrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMetrics.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns loading true initially", () => {
    mockMetrics.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() =>
      useMetrics("target-1", ["cpu"], "1h")
    );
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("fetches data on mount and sets loading false", async () => {
    const mockData = { cpu: [{ t: "2026-01-01T00:00:00Z", v: 42 }] };
    mockMetrics.mockResolvedValue(mockData);

    const { result } = renderHook(() =>
      useMetrics("target-1", ["cpu"], "1h")
    );

    await flushMicrotasks();

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeNull();
    expect(mockMetrics).toHaveBeenCalledWith("target-1", {
      metric: "cpu",
      range: "1h",
    });
  });

  it("sets error on failure", async () => {
    mockMetrics.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() =>
      useMetrics("target-1", ["cpu"], "1h")
    );

    await flushMicrotasks();

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("Network error");
  });

  it("returns empty data and loading false when no targetId", () => {
    const { result } = renderHook(() =>
      useMetrics(undefined, ["cpu"], "1h")
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual({});
    expect(mockMetrics).not.toHaveBeenCalled();
  });

  it("refreshes every 60s", async () => {
    const mockData = { cpu: [{ t: "2026-01-01T00:00:00Z", v: 10 }] };
    mockMetrics.mockResolvedValue(mockData);

    renderHook(() => useMetrics("target-1", ["cpu"], "1h"));

    // Flush initial fetch
    await flushMicrotasks();
    expect(mockMetrics).toHaveBeenCalledTimes(1);

    // Advance 60s for the interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mockMetrics).toHaveBeenCalledTimes(2);

    // Advance another 60s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mockMetrics).toHaveBeenCalledTimes(3);
  });

  it("cancels interval on unmount", async () => {
    mockMetrics.mockResolvedValue({});

    const { unmount } = renderHook(() =>
      useMetrics("target-1", ["cpu"], "1h")
    );

    // Flush initial fetch
    await flushMicrotasks();
    expect(mockMetrics).toHaveBeenCalledTimes(1);

    unmount();

    // Advancing timers should not cause additional calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mockMetrics).toHaveBeenCalledTimes(1);
  });
});
