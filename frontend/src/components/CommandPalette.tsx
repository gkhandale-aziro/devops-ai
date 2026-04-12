/**
 * CommandPalette.tsx — Cmd+K / Ctrl+K global command palette.
 * Searches targets, pages, K8s resources. Opens AIDrawer for AI queries.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { Target } from "../types";
import { api } from "../api/client";
import { openResourceDetail } from "../stores/resourceDetailStore";

interface Result {
  id:       string;
  icon:     string;
  label:    string;
  sub?:     string;
  accent?:  string;
  action:   () => void;
}

interface Props {
  targets:       Target[];
  activeTarget:  Target | null;
  onSelectTarget: (t: Target) => void;
}

// SVG icons as strings rendered via dangerouslySetInnerHTML — no emoji
const PAGE_ICONS: Record<string, string> = {
  home:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  dashboard: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  alerts:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  history:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  chat:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  ai:        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  target:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`,
  describe:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  logs:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  settings:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
};

// Action command prefixes: "<verb> <name>" → map verb to the tab to open.
// Used when typing (e.g. "describe nginx") to jump straight to an action.
const ACTION_VERBS: Record<string, { tab: "describe" | "logs" | "ai"; label: string; iconKey: string; accent: string }> = {
  describe: { tab: "describe", label: "Describe",   iconKey: "describe", accent: "var(--c-accent)"       },
  details:  { tab: "describe", label: "Details",    iconKey: "describe", accent: "var(--c-accent)"       },
  logs:     { tab: "logs",     label: "View logs",  iconKey: "logs",     accent: "#f59e0b"               },
  log:      { tab: "logs",     label: "View logs",  iconKey: "logs",     accent: "#f59e0b"               },
  ai:       { tab: "ai",       label: "AI analyze", iconKey: "ai",       accent: "var(--c-accent-hover)" },
  analyze:  { tab: "ai",       label: "AI analyze", iconKey: "ai",       accent: "var(--c-accent-hover)" },
};

const PAGES: Array<{ label: string; path: string; iconKey: string; accent: string }> = [
  { label: "Home",        path: "/",          iconKey: "home",      accent: "var(--c-accent)" },
  { label: "Dashboard",   path: "/dashboard", iconKey: "dashboard", accent: "var(--c-accent-hover)" },
  { label: "Live Alerts", path: "/alerts",    iconKey: "alerts",    accent: "#f43f5e" },
  { label: "History",     path: "/history",   iconKey: "history",   accent: "#06b6d4" },
  { label: "AI Chat",     path: "/chat",      iconKey: "chat",      accent: "var(--c-accent-hover)" },
  { label: "Settings",    path: "/settings",  iconKey: "settings",  accent: "var(--c-text-secondary)" },
];

// Module-level callback so SearchBar can open the palette without prop drilling
let _openPalette: (() => void) | null = null;

/** Inline search bar for the top bar — clicks open the command palette */
export function SearchBar() {
  return (
    <button
      data-tour="search"
      onClick={() => _openPalette?.()}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        background: "var(--c-bg-surface)", border: "1px solid var(--c-border)",
        borderRadius: 8, padding: "6px 14px",
        fontSize: 12, color: "var(--c-text-muted)", cursor: "pointer",
        transition: "border-color .15s",
        minWidth: 220,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--c-accent)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--c-border)"; }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      Search…
      <kbd style={{
        marginLeft: "auto", fontSize: 9, color: "var(--c-text-muted)",
        background: "var(--c-bg-raised)", border: "1px solid var(--c-border)",
        borderRadius: 3, padding: "1px 5px",
      }}>
        {navigator.platform.includes("Mac") ? "\u2318K" : "Ctrl+K"}
      </kbd>
    </button>
  );
}

export function CommandPalette({ targets, activeTarget, onSelectTarget }: Props) {
  const [open,    setOpen]    = useState(false);
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [active,  setActive]  = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

  // Register module-level callback so SearchBar can open us
  useEffect(() => {
    _openPalette = () => { setOpen(true); setQuery(""); setActive(0); };
    return () => { _openPalette = null; };
  }, []);

  // Global keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
        setQuery("");
        setActive(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Build results from query
  const buildResults = useCallback(async (q: string) => {
    const res: Result[] = [];
    const ql = q.toLowerCase();

    if (!q) {
      // Default: show pages + targets
      PAGES.forEach(p => res.push({
        id: p.path, icon: PAGE_ICONS[p.iconKey], label: p.label,
        sub: "Navigate", accent: p.accent,
        action: () => { nav(p.path); setOpen(false); },
      }));
      targets.forEach(t => res.push({
        id: t.id, icon: PAGE_ICONS.target, label: t.name,
        sub: t.type, accent: "#22c55e",
        action: () => { onSelectTarget(t); nav("/dashboard"); setOpen(false); },
      }));
      setResults(res);
      return;
    }

    // Filter pages
    PAGES.filter(p => p.label.toLowerCase().includes(ql)).forEach(p =>
      res.push({
        id: p.path, icon: PAGE_ICONS[p.iconKey], label: p.label,
        sub: "Page", accent: p.accent,
        action: () => { nav(p.path); setOpen(false); },
      })
    );

    // Filter targets
    targets.filter(t => t.name.toLowerCase().includes(ql) || t.type.includes(ql)).forEach(t =>
      res.push({
        id: t.id, icon: PAGE_ICONS.target, label: t.name,
        sub: `${t.type} · ${t.status}`, accent: "#22c55e",
        action: () => { onSelectTarget(t); nav("/dashboard"); setOpen(false); },
      })
    );

    // AI query shortcut
    res.push({
      id: "__ai__",
      icon: PAGE_ICONS.ai,
      label: `Ask AI: "${q}"`,
      sub: "Open AI Chat",
      accent: "var(--c-accent-hover)",
      action: () => { nav(`/chat`); setOpen(false); },
    });

    setResults(res);
    setActive(0);

    // K8s live search if there's an active target.
    //
    // Action verbs: if the query starts with "describe foo" / "logs foo" /
    // "ai foo", strip the verb before searching and force that action's
    // tab on the resulting rows.
    if (activeTarget && q.length >= 2) {
      const firstSpace = q.indexOf(" ");
      const firstWord  = firstSpace > 0 ? q.slice(0, firstSpace).toLowerCase() : "";
      const verb       = ACTION_VERBS[firstWord];
      // After stripping the verb, only the first token of what remains is
      // used for the backend grep. The backend's /search endpoint rejects
      // queries with spaces (regex validation), so "describe failed pod"
      // must become just "failed" — and the user's intent is best matched
      // by the first identifier they typed anyway.
      const remainder  = verb ? q.slice(firstSpace + 1).trim() : q;
      const searchTerm = remainder.split(/\s+/)[0] ?? "";
      if (verb && !searchTerm) return;
      setLoading(true);
      const controller = new AbortController();
      try {
        const { results: kres } = await api.search(activeTarget.id, searchTerm);
        if (controller.signal.aborted) return;
        const kindColors: Record<string, string> = { pod: "#22c55e", node: "var(--c-accent)", deployment: "#f59e0b" };
        // Pods/nodes get a primary row (Describe on Enter) plus two extra
        // action rows (Logs, AI analyze). Deployments get Describe only —
        // `kubectl logs` on a Deployment doesn't work without selecting a
        // pod, so the Logs shortcut would be misleading.
        const k8sResults: Result[] = [];
        for (const r of kres) {
          const kindLabel = r.kind.charAt(0).toUpperCase() + r.kind.slice(1);
          const ns        = r.namespace ?? "";
          const accent    = kindColors[r.kind] ?? "var(--c-text-muted)";
          const actionTab = verb?.tab ?? "describe";
          // Primary row — Enter opens the requested tab (default: Describe)
          k8sResults.push({
            id:     `k8s-${r.kind}-${r.name}-primary`,
            icon:   PAGE_ICONS.describe,
            label:  r.name,
            sub:    `${kindLabel}${ns ? " · " + ns : ""} · ${r.status}`,
            accent,
            action: () => {
              openResourceDetail(activeTarget.id, r.kind, r.name, ns, actionTab);
              setOpen(false);
            },
          });
          if (!verb && (r.kind === "pod" || r.kind === "node")) {
            // Extra action rows — View logs (pods only) + AI analyze
            if (r.kind === "pod") {
              k8sResults.push({
                id:     `k8s-${r.kind}-${r.name}-logs`,
                icon:   PAGE_ICONS.logs,
                label:  `View logs — ${r.name}`,
                sub:    `Tail last 150 lines${ns ? " · " + ns : ""}`,
                accent: "#f59e0b",
                action: () => {
                  openResourceDetail(activeTarget.id, r.kind, r.name, ns, "logs");
                  setOpen(false);
                },
              });
            }
            k8sResults.push({
              id:     `k8s-${r.kind}-${r.name}-ai`,
              icon:   PAGE_ICONS.ai,
              label:  `AI analyze — ${r.name}`,
              sub:    `Diagnose ${r.kind}${ns ? " · " + ns : ""}`,
              accent: "var(--c-accent-hover)",
              action: () => {
                openResourceDetail(activeTarget.id, r.kind, r.name, ns, "ai");
                setOpen(false);
              },
            });
          }
        }
        setResults(prev => [...prev.filter(r => r.id !== "__ai__"), ...k8sResults, prev.find(r => r.id === "__ai__")!].filter(Boolean));
      } catch { /* silent */ } finally {
        setLoading(false);
      }
      return () => controller.abort();
    }
  }, [targets, activeTarget, nav, onSelectTarget]);

  useEffect(() => {
    const t = setTimeout(() => buildResults(query), 120);
    return () => clearTimeout(t);
  }, [query, buildResults]);

  // Keyboard navigation
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    if (e.key === "Enter" && results[active]) { results[active].action(); }
    if (e.key === "Escape") setOpen(false);
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        style={{ position: "fixed", inset: 0, background: "#000000aa", zIndex: 200, backdropFilter: "blur(4px)" }}
      />

      {/* Palette */}
      <div style={{
        position: "fixed", top: "18%", left: "50%", transform: "translateX(-50%)",
        width: 580, maxWidth: "90vw",
        background: "var(--c-bg-raised)",
        border: "1px solid var(--c-border)",
        borderRadius: 12,
        boxShadow: "0 24px 80px #00000088, 0 0 0 1px color-mix(in srgb, var(--c-accent) 3%, transparent)",
        zIndex: 201,
        overflow: "hidden",
        animation: "fadeIn .15s ease-out",
      }}>
        {/* Input */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--c-bg-active)" }}>
          {loading ? (
            <span style={{ width: 16, height: 16, border: "2px solid var(--c-bg-active)", borderTopColor: "var(--c-accent)", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", flexShrink: 0 }} />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent)" strokeWidth="2" style={{ flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={activeTarget ? "Search… or try 'describe nginx', 'logs api', 'ai postgres'" : "Search pages, targets, pods, nodes…"}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "var(--c-text-primary)", fontSize: 15, fontFamily: "inherit",
            }}
          />
          <kbd style={{ fontSize: 10, color: "var(--c-text-muted)", background: "var(--c-bg-surface)", border: "1px solid var(--c-border)", borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>Esc</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 380, overflowY: "auto" }}>
          {results.length === 0 && (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--c-text-muted)", fontSize: 13 }}>No results</div>
          )}
          {results.map((r, i) => (
            <div
              key={r.id}
              onClick={r.action}
              onMouseEnter={() => setActive(i)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 16px", cursor: "pointer",
                background: active === i ? "var(--c-bg-active)" : "transparent",
                borderLeft: active === i ? `2px solid ${r.accent ?? "var(--c-accent)"}` : "2px solid transparent",
                transition: "background .08s",
              }}
            >
              <span style={{ color: r.accent ?? "var(--c-text-muted)", width: 20, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: r.icon }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--c-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</div>
                {r.sub && <div style={{ fontSize: 11, color: "var(--c-text-muted)", marginTop: 1 }}>{r.sub}</div>}
              </div>
              {active === i && (
                <kbd style={{ fontSize: 10, color: "var(--c-text-muted)", background: "var(--c-bg-raised)", border: "1px solid var(--c-border)", borderRadius: 3, padding: "2px 6px", flexShrink: 0 }}>↵</kbd>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "8px 16px", borderTop: "1px solid var(--c-bg-active)", display: "flex", gap: 16, fontSize: 10, color: "var(--c-text-muted)" }}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Esc close</span>
          {activeTarget && <span style={{ marginLeft: "auto" }}>Searching in <strong style={{ color: "var(--c-accent)" }}>{activeTarget.name}</strong></span>}
        </div>
      </div>
    </>
  );
}
