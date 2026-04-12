/**
 * dashboard/primitives.tsx — leaf presentational components extracted from
 * Dashboard.tsx. Pure UI, no data fetching, no Target dependency.
 */
import { useState, type ReactNode } from "react";
import { Command, Sparkles, Target, Play, ChevronDown, ChevronRight } from "lucide-react";
import { fadeInStyle, skeletonStyle } from "../../utils/animations";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT, SHADOW } from "../../utils/theme";

// ── RingChart — SVG donut ring for metric cards ─────────────────────────────

/** SVG donut-ring percentage indicator used in metric cards.
 *  @param pct   0–100 (values above 100 are clamped visually but still labeled literally).
 *  @param color Stroke color for the filled arc.
 *  @param size  Outer square size in px — default 52. */
export function RingChart({ pct, color, size = 52 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(Math.max(pct, 0), 100) / 100 * circ;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border.muted} strokeWidth={5} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={5}
          strokeDasharray={`${filled} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s cubic-bezier(0.25,0.46,0.45,0.94)" }}
        />
      </svg>
      <span style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        color, fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.bold, pointerEvents: "none",
      }}>
        {pct}%
      </span>
    </div>
  );
}

// ── PodSummaryBar — status breakdown above pod table ────────────────────────

/** Horizontal segmented bar showing pod status breakdown above PodTable.
 *  Animates segment widths on count changes (namespace filter, refresh). */
export function PodSummaryBar({ counts }: { counts: { running: number; pending: number; bad: number; total: number } }) {
  const other = counts.total - counts.running - counts.pending - counts.bad;
  const segments = [
    { label: "Running", count: counts.running, color: C.status.success },
    { label: "Pending", count: counts.pending, color: C.status.warning },
    { label: "Failed",  count: counts.bad,     color: C.status.danger },
    ...(other > 0 ? [{ label: "Other", count: other, color: C.text.muted }] : []),
  ];
  return (
    <div style={{ padding: `${SPACE.sm}px ${SPACE.lg}px`, background: C.bg.panel, borderBottom: `1px solid ${C.border.subtle}`, display: "flex", alignItems: "center", gap: SPACE.lg, flexShrink: 0 }}>
      <div style={{ flex: 1, height: 6, borderRadius: RADIUS.sm, background: C.border.subtle, display: "flex", overflow: "hidden" }}>
        {segments.map(seg => seg.count > 0 && (
          <div key={seg.label} style={{
            width: `${seg.count / counts.total * 100}%`,
            background: seg.color,
            transition: "width 0.5s cubic-bezier(0.25,0.46,0.45,0.94)",
          }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: SPACE.sm, flexShrink: 0 }}>
        {segments.map(seg => (
          <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: SPACE.xs }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: seg.color, display: "inline-block", boxShadow: seg.label === "Running" ? `0 0 5px ${seg.color}88` : "none" }} />
            <span style={{ fontSize: FONT_SIZE.sm, color: C.text.secondary, fontWeight: FONT_WEIGHT.medium }}>{seg.count} {seg.label}</span>
          </div>
        ))}
        <span style={{ fontSize: FONT_SIZE.sm, color: C.text.faint }}>/ {counts.total} total</span>
      </div>
    </div>
  );
}

// ── Card — collapsible section ──────────────────────────────────────────────

/** Collapsible section with header, optional hint, and animated body.
 *  Keyboard accessible: Enter/Space on the header toggles; aria-expanded
 *  + aria-hidden track state. Content stays in the DOM during collapse to
 *  allow smooth max-height/opacity transition.
 *  @param defaultOpen Initial open state; only consulted on mount. */
export function Card({ title, hint, children, defaultOpen = true }: { title: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const headerId = `card-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div style={{ background: C.bg.card, border: `1px solid ${C.border.muted}`, borderRadius: RADIUS.xl, overflow: "hidden", boxShadow: SHADOW.md }}>
      <div
        id={headerId}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
        style={{ padding: `${SPACE.sm}px ${SPACE.md}px`, borderBottom: open ? `1px solid ${C.border.muted}` : "none", fontSize: FONT_SIZE.md, fontWeight: FONT_WEIGHT.semibold, display: "flex", alignItems: "center", gap: SPACE.sm, cursor: "pointer", userSelect: "none", transition: "border-bottom-color .25s" }}
      >
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={C.text.muted} strokeWidth="1.5"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .2s ease", flexShrink: 0 }}>
          <polyline points="3,1 7,5 3,9" />
        </svg>
        {title}
        {hint && <span style={{ fontSize: FONT_SIZE.sm, color: C.text.muted, fontWeight: FONT_WEIGHT.normal }}>· {hint}</span>}
        <span aria-hidden="true" style={{ marginLeft: "auto", color: C.text.faint, display: "flex", alignItems: "center" }}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
      </div>
      <div
        role="region"
        aria-labelledby={headerId}
        aria-hidden={!open}
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
          transition: "grid-template-rows .3s ease, opacity .2s ease",
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div style={{ padding: `${SPACE.md}px ${SPACE.lg}px` }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

// ── No-target empty state ───────────────────────────────────────────────────

const FEATURE_HINTS: { icon: ReactNode; label: string; desc: string }[] = [
  { icon: <Command size={14} />,  label: "Command Palette", desc: "Jump to any resource instantly — press Cmd+K" },
  { icon: <Sparkles size={14} />, label: "AI Chat",         desc: "Ask your cluster anything in plain English" },
  { icon: <Target size={14} />,   label: "Topology",        desc: "Visualize Ingress, Service, Pod relationships" },
  { icon: <Play size={14} />,     label: "Live Logs",       desc: "Stream pod logs in real time with auto-scroll" },
];

export function NoTargetEmptyState() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 0, padding: 40 }}>
      <div style={{ textAlign: "center", maxWidth: 480 }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: `linear-gradient(135deg,${C.accent.primary},${C.accent.light})`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", boxShadow: `0 0 32px ${C.accent.primary}33` }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/>
          </svg>
        </div>
        <h2 style={{ fontSize: FONT_SIZE.xl, fontWeight: FONT_WEIGHT.bold, color: C.text.primary, marginBottom: SPACE.sm, letterSpacing: "-.3px" }}>
          Connect your first target
        </h2>
        <p style={{ fontSize: FONT_SIZE.md, color: C.text.muted, lineHeight: 1.7, marginBottom: SPACE.xxl }}>
          Add a Kubernetes cluster, SSH server, Docker host, or cloud account from the sidebar to start monitoring and managing your infrastructure with AI.
        </p>
        <div style={{ background: C.bg.elevated, border: `1px solid ${C.border.subtle}`, borderRadius: RADIUS.xl, padding: `${SPACE.lg}px ${SPACE.xl}px`, textAlign: "left", marginBottom: SPACE.xxl }}>
          <div style={{ fontSize: FONT_SIZE.sm, color: C.text.faint, textTransform: "uppercase", letterSpacing: ".6px", fontWeight: FONT_WEIGHT.bold, marginBottom: SPACE.md }}>Getting started</div>
          {[
            "Click + in the sidebar to add a connection",
            "Choose the target type — Kubernetes, SSH, Docker, AWS…",
            "Explore resources, stream logs, and ask AI anything",
          ].map((step, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: SPACE.sm, marginBottom: i < 2 ? SPACE.sm : 0 }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--c-bg-active)", border: `1px solid ${C.border.strong}`, color: C.accent.light, fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.bold, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
              <span style={{ fontSize: FONT_SIZE.md, color: C.text.secondary, lineHeight: 1.5 }}>{step}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACE.sm }}>
          {FEATURE_HINTS.map(f => (
            <div key={f.label} style={{ background: C.bg.panel, border: `1px solid ${C.border.subtle}`, borderRadius: RADIUS.lg, padding: `${SPACE.sm}px ${SPACE.md}px`, textAlign: "left", display: "flex", gap: SPACE.sm, alignItems: "flex-start" }}>
              <span style={{ width: 20, flexShrink: 0, color: C.accent.primary, display: "flex", alignItems: "center", justifyContent: "center" }}>{f.icon}</span>
              <div>
                <div style={{ fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold, color: C.text.primary, marginBottom: SPACE.xxs }}>{f.label}</div>
                <div style={{ fontSize: FONT_SIZE.sm, color: C.text.faint, lineHeight: 1.4 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Contextual hint (dismissable, stored in localStorage) ───────────────────

/** Dismissable info tip — persists dismissal in localStorage under `hint-<id>`.
 *  Sidebar's "Restore tips" button clears every `hint-*` key to bring all tips
 *  back for the current user. */
export function ContextualHint({ id, children }: { id: string; children: ReactNode }) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(`hint-${id}`) === "1");
  if (dismissed) return null;
  return (
    <div style={{ margin: `${SPACE.sm}px ${SPACE.lg}px 0`, background: `${C.status.info}12`, border: `1px solid ${C.status.info}33`, borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, display: "flex", alignItems: "center", gap: SPACE.sm, fontSize: FONT_SIZE.sm, color: C.status.info, flexShrink: 0 }}>
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span style={{ flex: 1 }}>{children}</span>
      <button onClick={() => { localStorage.setItem(`hint-${id}`, "1"); setDismissed(true); }}
        aria-label="Dismiss tip"
        style={{ background: "none", border: "none", color: C.text.faint, cursor: "pointer", fontSize: FONT_SIZE.md, padding: SPACE.xxs, display: "flex", alignItems: "center" }}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}

export function Pre({ children }: { children: ReactNode }) {
  return (
    <pre style={{ fontFamily: "'Cascadia Code','Consolas',monospace", fontSize: FONT_SIZE.sm, color: C.text.secondary, whiteSpace: "pre-wrap", lineHeight: 1.6, margin: 0 }}>
      {children}
    </pre>
  );
}

export function LoadingSpinner() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading" style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, gap: SPACE.sm, color: C.text.muted, fontSize: FONT_SIZE.md }}>
      <span aria-hidden="true" style={{ display: "inline-block", width: 16, height: 16, border: `2px solid ${C.border.muted}`, borderTopColor: "var(--c-accent-hover)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      Loading…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export type SkeletonVariant = "cards" | "table" | "mixed";

/** Animated placeholder shown during tab data fetch.
 *  @param variant "cards" for Overview-style 4-card rows, "table" for list
 *                 rows, "mixed" (default) for a card-row followed by a list. */
export function SkeletonLoader({ variant = "mixed" }: { variant?: SkeletonVariant } = {}) {
  return (
    <div role="status" aria-live="polite" aria-label="Loading content" style={{ flex: 1, padding: SPACE.lg, display: "flex", flexDirection: "column", gap: SPACE.md, ...fadeInStyle }}>
      {(variant === "cards" || variant === "mixed") && (
        <div style={{ display: "flex", gap: SPACE.md }}>
          {[1,2,3,4].map(i => (
            <div key={i} style={{ ...skeletonStyle, height: 72, flex: 1 }} />
          ))}
        </div>
      )}
      {(variant === "table" || variant === "mixed") && (
        <>
          <div style={{ ...skeletonStyle, height: 14, width: "35%", marginTop: variant === "mixed" ? SPACE.sm : 0 }} />
          {[1,2,3,4,5,6,7].slice(0, variant === "table" ? 7 : 5).map(i => (
            <div key={i} style={{ ...skeletonStyle, height: 36, width: `${100 - i * 2}%` }} />
          ))}
        </>
      )}
      <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>Loading content…</span>
    </div>
  );
}
