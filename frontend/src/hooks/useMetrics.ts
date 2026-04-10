import { useState, useEffect, useCallback } from "react";
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
 * Auto-refreshes every 60s. Returns { data, loading, error }.
 */
export function useMetrics(
  targetId: string | undefined,
  metrics: string[],
  range: string
): UseMetricsResult {
  const [data, setData] = useState<Record<string, MetricPoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const metricParam = metrics.join(",");

  const fetch_ = useCallback(async () => {
    if (!targetId) return;
    try {
      const result = await api.metrics(targetId, { metric: metricParam, range });
      setData(result);
      setError(null);
    } catch (e) {
      setError((e as Error)?.message ?? "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, [targetId, metricParam, range]);

  useEffect(() => {
    setLoading(true);
    fetch_();
    const interval = setInterval(fetch_, 60_000);
    return () => clearInterval(interval);
  }, [fetch_]);

  return { data, loading, error };
}
