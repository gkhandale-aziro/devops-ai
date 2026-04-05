/**
 * CommandPalette.tsx — Cmd+K / Ctrl+K global command palette.
 * Searches targets, pages, K8s resources. Opens AIDrawer for AI queries.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { Target } from "../types";
import { api } from "../api/client";

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

const PAGES: Array<{ label: string; path: string; icon: string; accent: string }> = [
  { label: "Home",       path: "/",         icon: "⌂",  accent: "#6366f1" },
  { label: "Dashboard",  path: "/dashboard", icon: "▦",  accent: "#818cf8" },
  { label: "Live Alerts",path: "/alerts",    icon: "⚡", accent: "#f43f5e" },
  { label: "History",    path: "/history",   icon: "◷",  accent: "#06b6d4" },
  { label: "AI Chat",    path: "/chat",      icon: "✦",  accent: "#818cf8" },
];

export function CommandPalette({ targets, activeTarget, onSelectTarget }: Props) {
  const [open,    setOpen]    = useState(false);
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [active,  setActive]  = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

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
        id: p.path, icon: p.icon, label: p.label,
        sub: "Navigate", accent: p.accent,
        action: () => { nav(p.path); setOpen(false); },
      }));
      targets.forEach(t => res.push({
        id: t.id, icon: "◉", label: t.name,
        sub: t.type, accent: "#22c55e",
        action: () => { onSelectTarget(t); nav("/dashboard"); setOpen(false); },
      }));
      setResults(res);
      return;
    }

    // Filter pages
    PAGES.filter(p => p.label.toLowerCase().includes(ql)).forEach(p =>
      res.push({
        id: p.path, icon: p.icon, label: p.label,
        sub: "Page", accent: p.accent,
        action: () => { nav(p.path); setOpen(false); },
      })
    );

    // Filter targets
    targets.filter(t => t.name.toLowerCase().includes(ql) || t.type.includes(ql)).forEach(t =>
      res.push({
        id: t.id, icon: "◉", label: t.name,
        sub: `${t.type} · ${t.status}`, accent: "#22c55e",
        action: () => { onSelectTarget(t); nav("/dashboard"); setOpen(false); },
      })
    );

    // AI query shortcut
    res.push({
      id: "__ai__",
      icon: "✦",
      label: `Ask AI: "${q}"`,
      sub: "Open AI Chat",
      accent: "#818cf8",
      action: () => { nav(`/chat`); setOpen(false); },
    });

    setResults(res);
    setActive(0);

    // K8s live search if there's an active target
    if (activeTarget && q.length >= 2) {
      setLoading(true);
      try {
        const { results: kres } = await api.search(activeTarget.id, q);
        const kindIcons: Record<string, string> = { pod: "◈", node: "◆", deployment: "⬡" };
        const kindColors: Record<string, string> = { pod: "#22c55e", node: "#6366f1", deployment: "#f59e0b" };
        const k8sResults: Result[] = kres.map(r => ({
          id:     `k8s-${r.kind}-${r.name}`,
          icon:   kindIcons[r.kind] ?? "◈",
          label:  r.name,
          sub:    `${r.kind}${r.namespace ? " · " + r.namespace : ""} · ${r.status}`,
          accent: kindColors[r.kind] ?? "#64748b",
          action: () => { nav("/dashboard"); setOpen(false); },
        }));
        setResults(prev => [...prev.filter(r => r.id !== "__ai__"), ...k8sResults, prev.find(r => r.id === "__ai__")!].filter(Boolean));
      } catch { /* silent */ } finally {
        setLoading(false);
      }
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

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      title="Command palette (Ctrl+K)"
      style={{
        position: "fixed", bottom: 20, right: 20, zIndex: 100,
        background: "#161b27", border: "1px solid #2d3555",
        borderRadius: 8, padding: "7px 12px",
        display: "flex", alignItems: "center", gap: 8,
        fontSize: 12, color: "#64748b", cursor: "pointer",
        boxShadow: "0 4px 20px #00000044",
        transition: "all .15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "#6366f1"; e.currentTarget.style.color = "#818cf8"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "#2d3555"; e.currentTarget.style.color = "#64748b"; }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      Search
      <kbd style={{ fontSize: 9, color: "#475569", background: "#0b0d14", border: "1px solid #2d3555", borderRadius: 3, padding: "1px 4px" }}>
        {navigator.platform.includes("Mac") ? "⌘K" : "Ctrl+K"}
      </kbd>
    </button>
  );

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
        background: "#0f1219",
        border: "1px solid #2d3555",
        borderRadius: 12,
        boxShadow: "0 24px 80px #00000088, 0 0 0 1px #6366f108",
        zIndex: 201,
        overflow: "hidden",
        animation: "fadeIn .15s ease-out",
      }}>
        {/* Input */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid #1e2235" }}>
          {loading ? (
            <span style={{ width: 16, height: 16, border: "2px solid #1e2235", borderTopColor: "#6366f1", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", flexShrink: 0 }} />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" style={{ flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search pages, targets, pods, nodes…"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "#e2e8f0", fontSize: 15, fontFamily: "inherit",
            }}
          />
          <kbd style={{ fontSize: 10, color: "#475569", background: "#161b27", border: "1px solid #2d3555", borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>Esc</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 380, overflowY: "auto" }}>
          {results.length === 0 && (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "#475569", fontSize: 13 }}>No results</div>
          )}
          {results.map((r, i) => (
            <div
              key={r.id}
              onClick={r.action}
              onMouseEnter={() => setActive(i)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 16px", cursor: "pointer",
                background: active === i ? "#1e2340" : "transparent",
                borderLeft: active === i ? `2px solid ${r.accent ?? "#6366f1"}` : "2px solid transparent",
                transition: "background .08s",
              }}
            >
              <span style={{ fontSize: 16, color: r.accent ?? "#64748b", width: 20, textAlign: "center", flexShrink: 0 }}>{r.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</div>
                {r.sub && <div style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>{r.sub}</div>}
              </div>
              {active === i && (
                <kbd style={{ fontSize: 10, color: "#475569", background: "#0b0d14", border: "1px solid #2d3555", borderRadius: 3, padding: "2px 6px", flexShrink: 0 }}>↵</kbd>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "8px 16px", borderTop: "1px solid #1e2235", display: "flex", gap: 16, fontSize: 10, color: "#374151" }}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Esc close</span>
          {activeTarget && <span style={{ marginLeft: "auto" }}>Searching in <strong style={{ color: "#6366f1" }}>{activeTarget.name}</strong></span>}
        </div>
      </div>
    </>
  );
}
