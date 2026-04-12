import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoRefresh, useStaleness } from "./useAutoRefresh";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutoRefresh", () => {
  it("defaults to 30s interval when no stored value", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useAutoRefresh(cb, "test-key"));
    expect(result.current.interval).toBe(30);
  });

  it("reads stored interval from localStorage", () => {
    localStorage.setItem("test-key", "60");
    const cb = vi.fn();
    const { result } = renderHook(() => useAutoRefresh(cb, "test-key"));
    expect(result.current.interval).toBe(60);
  });

  it("reads null (off) from localStorage", () => {
    localStorage.setItem("test-key", "null");
    const cb = vi.fn();
    const { result } = renderHook(() => useAutoRefresh(cb, "test-key"));
    expect(result.current.interval).toBeNull();
  });

  it("calls callback on interval ticks", () => {
    const cb = vi.fn();
    renderHook(() => useAutoRefresh(cb, "test-key"));
    // Default is 30s
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("does not call callback when interval is null (off)", () => {
    localStorage.setItem("test-key", "null");
    const cb = vi.fn();
    renderHook(() => useAutoRefresh(cb, "test-key"));
    vi.advanceTimersByTime(120_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("persists interval change to localStorage", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useAutoRefresh(cb, "test-key"));
    act(() => result.current.setInterval(15));
    expect(localStorage.getItem("test-key")).toBe("15");
    expect(result.current.interval).toBe(15);
  });

  it("markRefreshed sets lastRefreshed to current time", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useAutoRefresh(cb, "test-key"));
    expect(result.current.lastRefreshed).toBeNull();
    act(() => result.current.markRefreshed());
    expect(result.current.lastRefreshed).toBeInstanceOf(Date);
  });

  it("exposes intervalOptions array", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useAutoRefresh(cb, "test-key"));
    expect(result.current.intervalOptions).toHaveLength(4);
    expect(result.current.intervalOptions.map(o => o.value)).toEqual([15, 30, 60, null]);
  });
});

describe("useStaleness", () => {
  it("returns empty label when lastRefreshed is null", () => {
    const { result } = renderHook(() => useStaleness(null));
    expect(result.current.label).toBe("");
    expect(result.current.stale).toBe(false);
  });

  it("returns 'Updated just now' for recent refresh", () => {
    const { result } = renderHook(() => useStaleness(new Date()));
    expect(result.current.label).toBe("Updated just now");
    expect(result.current.stale).toBe(false);
  });

  it("returns seconds label and not stale for <60s", () => {
    const pastDate = new Date(Date.now() - 30_000);
    const { result } = renderHook(() => useStaleness(pastDate));
    expect(result.current.label).toMatch(/Updated \d+s ago/);
    expect(result.current.stale).toBe(false);
  });

  it("returns minutes label for >60s", () => {
    const pastDate = new Date(Date.now() - 90_000);
    const { result } = renderHook(() => useStaleness(pastDate));
    expect(result.current.label).toMatch(/Updated \d+m ago/);
    expect(result.current.stale).toBe(false);
  });

  it("marks stale when >120s", () => {
    const pastDate = new Date(Date.now() - 150_000);
    const { result } = renderHook(() => useStaleness(pastDate));
    expect(result.current.stale).toBe(true);
  });
});
