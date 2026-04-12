import { useEffect, useRef, useState, useCallback } from "react";

export type RefreshInterval = 15 | 30 | 60 | null;

const INTERVAL_OPTIONS: { label: string; value: RefreshInterval }[] = [
  { label: "15s", value: 15 },
  { label: "30s", value: 30 },
  { label: "60s", value: 60 },
  { label: "Off", value: null },
];

/**
 * Auto-refresh hook with configurable interval and live staleness tracking.
 *
 * @param callback  Called on each tick (and NOT on mount — the caller handles initial load).
 * @param storageKey  localStorage key to persist the chosen interval per target.
 */
export function useAutoRefresh(callback: () => void, storageKey: string) {
  const [interval, setIntervalValue] = useState<RefreshInterval>(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored === "null" || stored === "off") return null;
    const n = Number(stored);
    if (n === 15 || n === 30 || n === 60) return n;
    return 30; // default
  });

  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const cbRef = useRef(callback);
  cbRef.current = callback;

  const setInterval_ = useCallback((val: RefreshInterval) => {
    setIntervalValue(val);
    localStorage.setItem(storageKey, String(val));
  }, [storageKey]);

  /** Call this after a successful data load to reset the staleness timer. */
  const markRefreshed = useCallback(() => {
    setLastRefreshed(new Date());
  }, []);

  // Auto-refresh timer
  useEffect(() => {
    if (interval == null) return;
    const id = window.setInterval(() => cbRef.current(), interval * 1000);
    return () => window.clearInterval(id);
  }, [interval]);

  return {
    interval,
    setInterval: setInterval_,
    lastRefreshed,
    markRefreshed,
    intervalOptions: INTERVAL_OPTIONS,
  };
}

/**
 * Returns a live-updating "Xs ago" / "Xm ago" string and a stale flag.
 * Re-renders every second for accurate display.
 */
export function useStaleness(lastRefreshed: Date | null) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!lastRefreshed) return { label: "", stale: false };

  const diffSec = Math.round((now - lastRefreshed.getTime()) / 1000);
  const stale = diffSec > 120; // >2 minutes

  let label: string;
  if (diffSec < 5) label = "just now";
  else if (diffSec < 60) label = `${diffSec}s ago`;
  else label = `${Math.round(diffSec / 60)}m ago`;

  return { label: `Updated ${label}`, stale };
}
