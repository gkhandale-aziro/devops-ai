import { useEffect, useRef, useCallback } from "react";
import type { SSEEvent } from "../types";

/**
 * Subscribes to /api/monitor/stream and calls onEvent for each alert.
 * Automatically reconnects if the connection drops.
 */
export function useMonitorSSE(
  enabled: boolean,
  onEvent: (e: SSEEvent) => void
) {
  const esRef     = useRef<EventSource | null>(null);
  const cbRef     = useRef(onEvent);
  cbRef.current   = onEvent;

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource("/api/monitor/stream");
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as SSEEvent;
        cbRef.current(data);
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => {
      es.close();
      esRef.current = null;
      // Reconnect after 5 s
      if (enabled) setTimeout(connect, 5000);
    };
    esRef.current = es;
  }, [enabled]);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      esRef.current?.close();
      esRef.current = null;
    }
    return () => { esRef.current?.close(); };
  }, [enabled, connect]);
}
