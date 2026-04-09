import { useEffect, useRef, useCallback } from "react";
import type { SSEEvent } from "../types";

const MAX_RETRIES  = 10;
const BASE_DELAY   = 1000;   // 1s
const MAX_DELAY    = 60_000; // 60s

/**
 * Subscribes to /api/monitor/stream and calls onEvent for each alert.
 * Reconnects with exponential backoff; stops after MAX_RETRIES failures.
 */
export function useMonitorSSE(
  enabled: boolean,
  onEvent: (e: SSEEvent) => void
) {
  const esRef      = useRef<EventSource | null>(null);
  const cbRef      = useRef(onEvent);
  const retryRef   = useRef(0);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  cbRef.current    = onEvent;

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource("/api/monitor/stream");

    es.onopen = () => {
      retryRef.current = 0;  // reset backoff on successful connection
    };

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as SSEEvent;
        cbRef.current(data);
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      if (!enabled) return;
      if (retryRef.current >= MAX_RETRIES) return;  // give up

      const delay = Math.min(BASE_DELAY * Math.pow(2, retryRef.current), MAX_DELAY);
      retryRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    };

    esRef.current = es;
  }, [enabled]);

  useEffect(() => {
    if (enabled) {
      retryRef.current = 0;
      connect();
    } else {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      esRef.current?.close();
      esRef.current = null;
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      esRef.current?.close();
    };
  }, [enabled, connect]);
}
