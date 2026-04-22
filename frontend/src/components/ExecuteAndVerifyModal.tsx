import { useEffect, useRef, useState } from "react";
import { X, Play, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { StoredEvent, ExecuteResult } from "../types";
import { api } from "../api/client";
import {
  C, FONT_SIZE, FONT_WEIGHT, RADIUS, SHADOW, SPACE, Z_INDEX,
} from "../utils/theme";

/**
 * Modal that closes the Detect → Diagnose → Resolve → Verify loop from the UI.
 *
 * Two entry points:
 *   • "event"  — from History: dispatch against an existing StoredEvent.
 *   • "target" — from Dashboard: no event yet; backend find-or-creates one so
 *     the audit trail unifies with any monitor-caught incident.
 *
 * The operator sees the AI-proposed (or SRE-default) `kubectl …` command
 * editable — the backend re-validates verb + structure before running.
 * Three phases: idle (form), running (spinner + busy note), done (banner +
 * verification trail). On success the parent should refresh so the execution
 * and verification snapshots render alongside describe/logs.
 */
export type ExecuteAndVerifyModalMode =
  | { kind: "event"; event: StoredEvent }
  | {
      kind:       "target";
      targetId:   string;
      targetName: string;
      object:     string;
      namespace:  string;
      reason:     string;
    };

export interface ExecuteAndVerifyModalProps {
  open:            boolean;
  mode:            ExecuteAndVerifyModalMode;
  initialCommand:  string;
  onClose:         () => void;
  onCompleted?:    (result: ExecuteResult) => void;
}

type Phase = "idle" | "running" | "done";

function modeLabels(mode: ExecuteAndVerifyModalMode): { object: string; targetName: string } {
  if (mode.kind === "event") {
    return {
      object:     mode.event.object,
      targetName: mode.event.target_name ?? "the target",
    };
  }
  return { object: mode.object, targetName: mode.targetName };
}

export function ExecuteAndVerifyModal({
  open,
  mode,
  initialCommand,
  onClose,
  onCompleted,
}: ExecuteAndVerifyModalProps) {
  const [command, setCommand] = useState(initialCommand);
  const [phase,   setPhase]   = useState<Phase>("idle");
  const [result,  setResult]  = useState<ExecuteResult | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset whenever the modal opens afresh — a stale result from a previous
  // event shouldn't flash when the operator clicks a different incident.
  useEffect(() => {
    if (!open) return;
    setCommand(initialCommand);
    setPhase("idle");
    setResult(null);
    setError(null);
    dialogRef.current?.focus();
  }, [open, initialCommand]);

  if (!open) return null;

  const labels = modeLabels(mode);

  async function runExecute() {
    const trimmed = command.trim();
    if (!trimmed) {
      setError("command is empty");
      return;
    }
    if (!trimmed.startsWith("kubectl ")) {
      setError("only kubectl commands are accepted");
      return;
    }
    setError(null);
    setPhase("running");
    try {
      const res = mode.kind === "event"
        ? await api.events.execute(mode.event.id, trimmed)
        : await api.targets.executeResolve(mode.targetId, {
            object:    mode.object,
            namespace: mode.namespace,
            reason:    mode.reason,
            command:   trimmed,
          });
      setResult(res);
      setPhase("done");
      if (res.final_status === "resolved") {
        toast.success("Remediation verified — object healthy");
      } else {
        toast.error("Remediation ran but verification failed");
      }
      onCompleted?.(res);
    } catch (e) {
      setPhase("idle");
      setError((e as Error)?.message ?? "execute failed");
    }
  }

  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
    backdropFilter: "blur(2px)", zIndex: Z_INDEX.modal,
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  const box: React.CSSProperties = {
    background: C.bg.card, border: `1px solid ${C.border.muted}`,
    borderRadius: RADIUS.xl, padding: SPACE.xxl,
    width: 620, maxWidth: "92vw", maxHeight: "90vh", overflowY: "auto",
    boxShadow: SHADOW.lg, outline: "none",
  };

  return (
    <div
      style={overlay}
      onClick={e => e.target === e.currentTarget && phase !== "running" && onClose()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="execute-verify-title"
        style={box}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: SPACE.md }}>
          <strong id="execute-verify-title" style={{ fontSize: FONT_SIZE.md, color: C.text.primary }}>
            Execute &amp; Verify — {labels.object}
          </strong>
          <button
            onClick={onClose}
            disabled={phase === "running"}
            aria-label="Close"
            style={{
              marginLeft: "auto", background: "none", border: "none",
              color: C.text.muted,
              cursor: phase === "running" ? "not-allowed" : "pointer",
              opacity: phase === "running" ? 0.5 : 1,
              display: "flex", alignItems: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ fontSize: FONT_SIZE.sm, color: C.text.secondary, marginBottom: SPACE.md, lineHeight: 1.5 }}>
          Runs the command against{" "}
          <strong style={{ color: C.text.primary }}>
            {labels.targetName}
          </strong>{" "}
          and polls{" "}
          <code style={{ background: C.bg.base, padding: "1px 4px", borderRadius: RADIUS.sm }}>
            kubectl
          </code>{" "}
          until the object is healthy (up to 60s). Command is editable — review
          before clicking Execute.
        </div>

        <label htmlFor="execute-verify-command" style={{ display: "block", fontSize: FONT_SIZE.sm, color: C.text.secondary, marginBottom: SPACE.xs }}>
          kubectl command
        </label>
        <textarea
          id="execute-verify-command"
          value={command}
          onChange={e => setCommand(e.target.value)}
          disabled={phase !== "idle"}
          spellCheck={false}
          rows={3}
          style={{
            width: "100%", boxSizing: "border-box",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: FONT_SIZE.sm,
            background: C.bg.base, color: C.text.primary,
            border: `1px solid ${C.border.muted}`,
            borderRadius: RADIUS.md, padding: SPACE.sm,
            resize: "vertical",
          }}
        />

        {error && (
          <div style={{ marginTop: SPACE.sm, fontSize: FONT_SIZE.sm, color: "var(--c-sev1)", display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {phase === "running" && (
          <RunningPanel />
        )}

        {phase === "done" && result && (
          <ResultPanel result={result} />
        )}

        <div style={{ display: "flex", gap: SPACE.sm, marginTop: SPACE.lg, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            disabled={phase === "running"}
            style={{
              background: C.bg.card, border: `1px solid ${C.border.muted}`,
              color: C.text.secondary, borderRadius: RADIUS.md,
              padding: "8px 14px", fontSize: FONT_SIZE.sm,
              cursor: phase === "running" ? "not-allowed" : "pointer",
              opacity: phase === "running" ? 0.5 : 1,
            }}
          >
            {phase === "done" ? "Close" : "Cancel"}
          </button>
          {phase !== "done" && (
            <button
              onClick={runExecute}
              disabled={phase === "running"}
              style={{
                background: "var(--c-accent)", border: "none",
                color: "var(--c-accent-fg, #fff)",
                borderRadius: RADIUS.md, padding: "8px 16px",
                fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold,
                cursor: phase === "running" ? "not-allowed" : "pointer",
                display: "inline-flex", alignItems: "center", gap: 6,
                opacity: phase === "running" ? 0.7 : 1,
              }}
            >
              {phase === "running"
                ? <><Loader2 size={14} className="spin" /> Running…</>
                : <><Play size={14} /> Execute &amp; Verify</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RunningPanel() {
  return (
    <div style={{
      marginTop: SPACE.md, padding: SPACE.md,
      background: C.bg.base, border: `1px solid ${C.border.muted}`,
      borderRadius: RADIUS.md, fontSize: FONT_SIZE.sm, color: C.text.secondary,
      display: "flex", alignItems: "center", gap: SPACE.sm,
    }}>
      <Loader2 size={16} className="spin" style={{ color: "var(--c-accent)" }} />
      <div>
        <div style={{ color: C.text.primary, fontWeight: FONT_WEIGHT.medium }}>
          Executing, then verifying…
        </div>
        <div style={{ marginTop: 2 }}>
          The verifier polls the object every 5s and needs 15s of continuous
          health before declaring success. This can take up to a minute.
        </div>
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: ExecuteResult }) {
  const { execution, verification } = result;
  const ok = verification.success;
  return (
    <div style={{ marginTop: SPACE.md, display: "flex", flexDirection: "column", gap: SPACE.md }}>
      <ResultBanner ok={ok} note={verification.note} predicate={verification.predicate} />

      <CollapsibleBlock
        label={`Execution output · ${execution.duration_s.toFixed(2)}s`}
        defaultOpen={!ok}
        body={execution.output || "(no output)"}
      />

      <CollapsibleBlock
        label={`Verification · ${verification.attempts.length} probe(s) · ${verification.duration_s.toFixed(1)}s`}
        defaultOpen={!ok}
        body={formatAttempts(verification)}
      />
    </div>
  );
}

function ResultBanner({ ok, note, predicate }: { ok: boolean; note: string; predicate: string }) {
  return (
    <div style={{
      padding: SPACE.md,
      background: ok ? "var(--c-green-bg)" : "var(--c-sev1-bg)",
      border: `1px solid ${ok ? "var(--c-green)" : "var(--c-sev1)"}`,
      borderRadius: RADIUS.md,
      display: "flex", alignItems: "flex-start", gap: SPACE.sm,
    }}>
      {ok
        ? <CheckCircle2  size={18} style={{ color: "var(--c-green)",  flexShrink: 0, marginTop: 1 }} />
        : <AlertTriangle size={18} style={{ color: "var(--c-sev1)",   flexShrink: 0, marginTop: 1 }} />}
      <div style={{ fontSize: FONT_SIZE.sm, color: C.text.primary, lineHeight: 1.5 }}>
        <div style={{ fontWeight: FONT_WEIGHT.semibold }}>
          {ok ? "Resolved — object healthy" : "Not yet healthy"}
        </div>
        <div style={{ color: C.text.secondary, marginTop: 2 }}>
          Predicate: {predicate || "(none)"}
        </div>
        {note && (
          <div style={{ color: C.text.secondary, marginTop: 2 }}>
            {note}
          </div>
        )}
      </div>
    </div>
  );
}

function CollapsibleBlock({ label, body, defaultOpen }: { label: string; body: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: "none", border: "none", padding: 0, cursor: "pointer",
          color: C.text.muted, fontSize: FONT_SIZE.xs,
          textTransform: "uppercase", letterSpacing: ".5px",
        }}
      >
        {open ? "▾" : "▸"} {label}
      </button>
      {open && (
        <pre style={{
          marginTop: SPACE.xs,
          background: C.bg.base, color: C.text.secondary,
          border: `1px solid ${C.border.muted}`,
          borderRadius: RADIUS.md, padding: SPACE.sm,
          fontSize: FONT_SIZE.xs, whiteSpace: "pre-wrap",
          maxHeight: 240, overflowY: "auto",
          fontFamily: "var(--font-mono, monospace)",
        }}>
          {body}
        </pre>
      )}
    </div>
  );
}

function formatAttempts(v: ExecuteResult["verification"]): string {
  if (!v.attempts.length) return "(no probes recorded)";
  return v.attempts
    .map((a, i) =>
      `#${i + 1} ${a.healthy ? "OK " : "-- "}${a.output || "(empty)"}`
    )
    .join("\n");
}
