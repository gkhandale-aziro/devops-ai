import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";

interface MetricPoint {
  t: string;
  v: number;
}

interface UseMetricsResult {
  data: Record<string, MetricPoint[]>;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches metric time-series from /api/v1/metrics/<targetId>.
 * Auto-refreshes every 60s. Cancels in-flight requests on param change.
 */
export function useMetrics(
  targetId: string | undefined,
  metrics: string[],
  range: string
): UseMetricsResult {
  const [data, setData] = useState<Record<string, MetricPoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const metricParam = metrics.join(",");

  useEffect(() => {
    if (!targetId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchMetrics() {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      try {
        const result = await api.metrics(targetId!, { metric: metricParam, range });
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error)?.message ?? "Failed to load metrics");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [targetId, metricParam, range]);

  return { data, loading, error };
}
