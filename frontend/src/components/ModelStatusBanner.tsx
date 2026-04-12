/**
 * ModelStatusBanner — Shows a dismissible banner when the AI model is
 * degraded (quota exhausted) with fallback info or action to switch.
 *
 * Polls /api/v1/models/health every 30s. Hidden when model is healthy.
 */
import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { api, type ModelHealthStatus } from "../api/client";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT } from "../utils/theme";

interface Props {
  /** Called when user explicitly switches model from the banner. */
  onModelChange?: () => void;
}

const POLL_INTERVAL = 30_000; // 30s

export function ModelStatusBanner({ onModelChange }: Props) {
  const [health, setHealth] = useState<ModelHealthStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const poll = useCallback(() => {
    api.modelHealth()
      .then(h => {
        setHealth(h);
        // Un-dismiss if status changes (e.g. recovered or new fallback)
        if (h.status === "healthy") setDismissed(false);
      })
      .catch(() => {}); // silent — don't spam errors
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [poll]);

  // Don't render if healthy, dismissed, or no data yet
  if (!health || health.status === "healthy" || dismissed) return null;

  const isFallback = health.status === "fallback";
  const isUnavailable = health.status === "unavailable";

  const bgColor = isFallback
    ? `var(--c-sev2-bg, ${C.status.warning}18)`
    : `var(--c-sev1-bg, ${C.status.danger}18)`;
  const borderColor = isFallback
    ? `var(--c-sev2, ${C.status.warning})`
    : `var(--c-sev1, ${C.status.danger})`;
  const textColor = isFallback
    ? `var(--c-sev2, ${C.status.warning})`
    : `var(--c-sev1, ${C.status.danger})`;

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: SPACE.sm,
        padding: `${SPACE.sm}px ${SPACE.md}px`,
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 0,
        fontSize: FONT_SIZE.sm,
        color: textColor,
        flexShrink: 0,
      }}
    >
      <AlertTriangle size={14} style={{ flexShrink: 0 }} />

      <div style={{ flex: 1 }}>
        {isFallback && (
          <>
            <strong>AI model quota exhausted</strong>
            {" — auto-switched to local Ollama "}
            <strong>{health.fallback_model}</strong>
            {". Will retry primary every 5 min."}
          </>
        )}
        {isUnavailable && (
          <>
            <strong>AI model quota exhausted</strong>
            {" — no local Ollama found. "}
            <span>Install Ollama and pull a model for automatic fallback, or wait for quota reset.</span>
          </>
        )}
      </div>

      {isUnavailable && (
        <a
          href="https://ollama.ai"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: FONT_SIZE.sm,
            fontWeight: FONT_WEIGHT.semibold,
            color: textColor,
            textDecoration: "underline",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          Get Ollama
        </a>
      )}

      {isFallback && onModelChange && (
        <button
          onClick={onModelChange}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: `${SPACE.xs}px ${SPACE.sm}px`,
            borderRadius: RADIUS.md,
            border: `1px solid ${borderColor}`,
            background: "transparent",
            color: textColor,
            fontSize: FONT_SIZE.sm,
            fontWeight: FONT_WEIGHT.semibold,
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          <RefreshCw size={11} /> Settings
        </button>
      )}

      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss banner"
        style={{
          background: "none",
          border: "none",
          color: textColor,
          cursor: "pointer",
          padding: 2,
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          opacity: 0.7,
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
