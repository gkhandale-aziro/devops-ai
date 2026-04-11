import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Zap, Home as HomeIcon, LayoutGrid, Bell, Clock, MessageSquare, Settings, Wifi, X, Plus, RotateCcw, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { Target } from "../types";
import { ThemeToggle } from "./ThemeContext";
import { TARGET_META } from "../utils/targetIcons";
import { api } from "../api/client";

interface Props {
  targets:       Target[];
  activeId:      string | null;
  onSelect:      (t: Target) => void;
  onRemove:      (id: string) => void;
  onAddClick:    () => void;
  monitorActive: boolean;
  aiModel:       string;
  onModelChange?: (model: string) => void;
  modelStatus?:  "healthy" | "degraded" | "fallback" | "unavailable";
}

const TYPE_COLORS: Record<string, string> = {
  kubernetes: "#326CE5", ssh: "#22c55e", local: "#22c55e",
  docker: "#2496ED", aws: "#FF9900", gcp: "#4285F4",
  azure: "#0078D4", terraform: "#7B42BC",
};

const STATUS_COLORS: Record<string, string> = {
  healthy: "#22c55e", degraded: "#f59e0b", fallback: "#f59e0b", unavailable: "#ef4444",
};

export function Sidebar({ targets, activeId, onSelect, onRemove, onAddClick, monitorActive, aiModel, onModelChange, modelStatus = "healthy" }: Props) {
  const loc = useLocation();
  const nav = useNavigate();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [availableModels, setAvailableModels] = useState<{ name: string; provider: string }[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [switching, setSwitching] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    if (!showModelPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
        setSwitchError("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showModelPicker]);

  function openModelPicker() {
    setShowModelPicker(true);
    setModelLoading(true);
    setSwitchError("");
    api.models.list().then(data => {
      const seen = new Set<string>();
      const models: { name: string; provider: string }[] = [];
      const add = (name: string, provider: string) => {
        if (!seen.has(name)) { seen.add(name); models.push({ name, provider }); }
      };
      // Current model first
      if (aiModel) add(aiModel, aiModel.split("/")[0]);
      // Cloud models
      if (data.cloud) data.cloud.forEach(m => add(m, m.split("/")[0]));
      // Ollama models
      if (data.ollama) data.ollama.forEach(m => add(`ollama/${m}`, "ollama"));
      setAvailableModels(models);
    }).catch(() => {}).finally(() => setModelLoading(false));
  }

  function selectModel(model: string) {
    setSwitching(model);
    setSwitchError("");
    api.models.update({ ai_model: model }).then(() => {
      setShowModelPicker(false);
      onModelChange?.(model);
    }).catch(e => {
      const msg = (e as Error)?.message ?? String(e);
      // Extract error from JSON response if possible
      try { setSwitchError(JSON.parse(msg.replace(/^.*?{/, "{")).error); }
      catch { setSwitchError(msg.includes("unreachable") ? msg : "Model unreachable — check connection"); }
    }).finally(() => setSwitching(""));
  }

  const navItem = (to: string, label: string, icon: ReactNode, badge?: ReactNode): ReactNode => {
    const active = loc.pathname === to;
    return (
      <Link
        to={to}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "7px 12px", borderRadius: 7, fontSize: 13,
          color: active ? "var(--c-text-primary,#f1f5f9)" : "var(--c-text-muted,#64748b)",
          background: active ? "var(--c-accent-dim,#6366f122)" : "transparent",
          borderLeft: active ? "2px solid var(--c-accent,#6366f1)" : "2px solid transparent",
          textDecoration: "none", transition: "all .15s",
          fontWeight: active ? 600 : 400,
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--c-bg-raised,#0f1629)"; }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
      >
        <span style={{ flexShrink: 0, color: active ? "var(--c-accent-hover,#818cf8)" : "var(--c-text-muted,#64748b)", transition: "color .15s" }}>
          {icon}
        </span>
        <span style={{ flex: 1 }}>{label}</span>
        {badge}
      </Link>
    );
  };

  const onlineCount = targets.filter(t => t.status === "online").length;

  return (
    <nav aria-label="Main navigation" style={{
      width: 236,
      background: "var(--c-bg-surface,#0a0f1e)",
      borderRight: "1px solid var(--c-border,#1a2235)",
      boxShadow: "2px 0 12px #00000033",
      display: "flex", flexDirection: "column",
      flexShrink: 0, height: "100vh",
    }}>

      {/* ── Logo ───────────────────────────────────────────────────────────── */}
      <div style={{
        padding: "14px 16px 12px",
        borderBottom: "1px solid var(--c-border,#1a2235)",
        display: "flex", alignItems: "center", gap: 11,
        flexShrink: 0,
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: "linear-gradient(135deg,#6366f1 0%,#818cf8 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
          boxShadow: "0 0 16px #6366f144, 0 2px 8px #6366f133",
        }}>
          <Zap size={14} fill="white" stroke="white" />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--c-text-primary,#f1f5f9)", letterSpacing: "-.3px", lineHeight: 1.2 }}>
            Aziro<span style={{ color: "var(--c-accent,#6366f1)" }}>Ops</span>
          </div>
          <div style={{ fontSize: 9, color: "var(--c-text-faint,#475569)", textTransform: "uppercase", letterSpacing: ".7px", marginTop: 1, fontWeight: 500 }}>
            DevOps AI Platform
          </div>
        </div>
      </div>

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: 1, flexShrink: 0 }}>
        {navItem("/", "Home", <HomeIcon size={15} />)}
        {navItem("/dashboard", "Dashboard", <LayoutGrid size={15} />)}
        {navItem("/alerts", "Live Alerts", <Bell size={15} />,
          monitorActive && (
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: "#22c55e", animation: "pulse 1.5s infinite",
              display: "inline-block", boxShadow: "0 0 6px #22c55e",
              flexShrink: 0,
            }} />
          )
        )}
        {navItem("/history", "History", <Clock size={15} />)}
        {navItem("/chat", "AI Chat", <MessageSquare size={15} />)}
        {navItem("/settings", "Settings", <Settings size={15} />)}
      </div>

      {/* ── Connections header ─────────────────────────────────────────────── */}
      <div style={{
        padding: "10px 16px 6px",
        borderTop: "1px solid var(--c-border,#1a2235)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: "var(--c-text-faint,#475569)", textTransform: "uppercase", letterSpacing: ".9px", fontWeight: 700 }}>
          Connections
        </span>
        {targets.length > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700,
            background: onlineCount > 0 ? "#22c55e18" : "var(--c-bg-overlay,#182035)",
            color: onlineCount > 0 ? "#22c55e" : "var(--c-text-faint,#475569)",
            border: `1px solid ${onlineCount > 0 ? "#22c55e33" : "var(--c-border,#1a2235)"}`,
            borderRadius: 5, padding: "1px 7px",
          }}>
            {onlineCount}/{targets.length}
          </span>
        )}
      </div>

      {/* ── Connection list (scrollable, takes remaining space) ────────────── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 6px", minHeight: 0 }}>

        {targets.length === 0 && (
          <div style={{ padding: "20px 12px", textAlign: "center" }}>
            <div style={{
              width: 36, height: 36, borderRadius: 9,
              background: "var(--c-bg-overlay,#182035)",
              border: "1px solid var(--c-border,#1a2235)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 8px",
            }}>
              <Wifi size={16} stroke="var(--c-text-faint,#475569)" strokeWidth={1.5} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text-secondary,#94a3b8)", marginBottom: 3 }}>No connections yet</div>
            <div style={{ fontSize: 10, color: "var(--c-text-faint,#475569)", lineHeight: 1.5 }}>Add a target below</div>
          </div>
        )}

        {targets.map(t => {
          const isActive  = t.id === activeId;
          const isHovered = t.id === hoveredId;
          const dotColor  = t.status === "online" ? "#22c55e" : t.status === "offline" ? "#ef4444" : "var(--c-text-muted)";
          const typeColor = TYPE_COLORS[t.type] ?? "#64748b";

          return (
            <div
              key={t.id}
              onClick={() => { onSelect(t); nav("/dashboard"); }}
              onMouseEnter={() => setHoveredId(t.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: "flex", alignItems: "center", gap: 9,
                padding: "7px 8px", borderRadius: 8, cursor: "pointer",
                marginBottom: 2, transition: "all .15s",
                background: isActive
                  ? "var(--c-accent-dim,#6366f122)"
                  : isHovered ? "var(--c-bg-raised,#0f1629)" : "transparent",
                border: `1px solid ${isActive ? "var(--c-accent,#6366f1)33" : "transparent"}`,
                boxShadow: isActive ? "0 2px 8px #6366f122" : "none",
              }}
            >
              {/* Type badge */}
              <div style={{
                width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                background: `${typeColor}18`,
                border: `1px solid ${typeColor}33`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: typeColor,
              }}>
                {(() => { const meta = TARGET_META[t.type as keyof typeof TARGET_META]; if (meta) { const Icon = meta.icon; return <Icon size={13} />; } return <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: ".4px" }}>{t.type.slice(0, 3).toUpperCase()}</span>; })()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: isActive ? 700 : 500,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: isActive ? "var(--c-text-primary,#f1f5f9)" : "var(--c-text-secondary,#94a3b8)",
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                  {t.name}
                  {t.type === "local" && (
                    <span style={{ fontSize: 8, color: "#22c55e", fontWeight: 800, background: "#22c55e18", border: "1px solid #22c55e33", padding: "0px 4px", borderRadius: 3, letterSpacing: ".3px", flexShrink: 0 }}>
                      LOCAL
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: "50%", background: dotColor,
                    boxShadow: t.status === "online" ? `0 0 5px ${dotColor}` : "none",
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 10, color: dotColor, fontWeight: 600 }}>{t.status ?? "unknown"}</span>
                </div>
              </div>

              <button
                onClick={e => { e.stopPropagation(); onRemove(t.id); }}
                aria-label="Remove connection"
                style={{
                  background: "none", border: "none",
                  color: "var(--c-text-faint,#475569)",
                  cursor: "pointer", padding: "3px", borderRadius: 4,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: isHovered ? 1 : 0,
                  transition: "opacity .15s, color .15s",
                  flexShrink: 0,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                onMouseLeave={e => (e.currentTarget.style.color = "var(--c-text-faint,#475569)")}
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            </div>
          );
        })}

        {/* Add connection button */}
        <button
          data-tour="add-connection"
          onClick={onAddClick}
          style={{
            width: "100%", marginTop: targets.length > 0 ? 4 : 2,
            padding: "8px 12px",
            background: "transparent",
            border: "1px solid var(--c-border-strong,#263050)",
            borderRadius: 8,
            color: "var(--c-accent,#6366f1)",
            fontSize: 11, fontWeight: 600,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            transition: "all .15s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "var(--c-accent-dim,#6366f118)";
            e.currentTarget.style.borderColor = "var(--c-accent,#6366f1)";
            e.currentTarget.style.boxShadow  = "0 0 12px #6366f122";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "var(--c-border-strong,#263050)";
            e.currentTarget.style.boxShadow  = "none";
          }}
        >
          <Plus size={12} strokeWidth={2.5} />
          Add Connection
        </button>
      </div>

      {/* ── Footer — compact: model + theme + tips in one row ─────────────── */}
      <div style={{
        borderTop: "1px solid var(--c-border,#1a2235)",
        padding: "8px 12px",
        flexShrink: 0,
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        {/* AI model selector + theme toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }} ref={pickerRef}>
          {aiModel && (
            <button
              data-tour="model-picker"
              onClick={openModelPicker}
              style={{
                display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0,
                background: "none", border: "1px solid transparent", borderRadius: 5,
                padding: "3px 6px", cursor: "pointer", transition: "all .15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--c-bg-raised,#0f1629)"; e.currentTarget.style.borderColor = "var(--c-border,#1a2235)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "transparent"; }}
              title="Click to change AI model"
            >
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: STATUS_COLORS[modelStatus] ?? "#22c55e",
                boxShadow: `0 0 6px ${STATUS_COLORS[modelStatus] ?? "#22c55e"}88`,
                flexShrink: 0, animation: "pulse 2s infinite",
              }} />
              <div style={{
                fontSize: 10, fontWeight: 600,
                color: "var(--c-accent-hover,#818cf8)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                flex: 1, textAlign: "left",
              }}>
                {aiModel.replace("gemini/", "").replace("ollama/", "").replace("openai/", "")}
              </div>
              <ChevronDown size={10} color="var(--c-text-faint,#475569)" style={{ flexShrink: 0 }} />
            </button>
          )}
          <ThemeToggle />

          {/* Model picker dropdown */}
          {showModelPicker && (
            <div style={{
              position: "absolute", bottom: "100%", left: 0, right: 0,
              marginBottom: 4, background: "var(--c-bg-raised,#0f1629)",
              border: "1px solid var(--c-border,#1a2235)", borderRadius: 8,
              boxShadow: "0 8px 24px #00000066", zIndex: 50,
              maxHeight: 240, overflowY: "auto",
            }}>
              <div style={{ padding: "8px 10px 4px", fontSize: 9, color: "var(--c-text-faint,#475569)", textTransform: "uppercase", letterSpacing: ".6px", fontWeight: 700 }}>
                Select Model
              </div>
              {modelLoading ? (
                <div style={{ padding: "12px 10px", fontSize: 11, color: "var(--c-text-muted,#64748b)", textAlign: "center" }}>Loading…</div>
              ) : availableModels.length === 0 ? (
                <div style={{ padding: "12px 10px", fontSize: 11, color: "var(--c-text-muted,#64748b)", textAlign: "center" }}>No models found</div>
              ) : (() => {
                // Group models by provider
                const groups = new Map<string, { name: string; provider: string }[]>();
                for (const m of availableModels) {
                  const list = groups.get(m.provider) ?? [];
                  list.push(m);
                  groups.set(m.provider, list);
                }
                return Array.from(groups.entries()).map(([provider, models]) => (
                  <div key={provider}>
                    <div style={{ padding: "6px 10px 2px", fontSize: 9, color: "var(--c-text-faint,#475569)", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700 }}>
                      {provider}
                    </div>
                    {models.map(m => {
                      const isActive = m.name === aiModel;
                      const isSwitching = switching === m.name;
                      const display = m.name.replace(/^(gemini|ollama|openai|anthropic)\//, "");
                      return (
                        <button
                          key={m.name}
                          onClick={() => selectModel(m.name)}
                          disabled={!!switching}
                          style={{
                            display: "flex", alignItems: "center", gap: 8, width: "100%",
                            padding: "7px 10px", background: isActive ? "var(--c-accent-dim,#6366f122)" : "transparent",
                            border: "none", borderLeft: isActive ? "2px solid var(--c-accent,#6366f1)" : "2px solid transparent",
                            cursor: switching ? "wait" : "pointer", transition: "background .1s", textAlign: "left",
                            opacity: switching && !isSwitching ? 0.5 : 1,
                          }}
                          onMouseEnter={e => { if (!isActive && !switching) e.currentTarget.style.background = "var(--c-bg-surface,#0a0f1e)"; }}
                          onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: isActive ? 600 : 400, color: isActive ? "var(--c-text-primary,#f1f5f9)" : "var(--c-text-secondary,#94a3b8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {isSwitching ? "Switching…" : display}
                            </div>
                          </div>
                          {isActive && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />}
                        </button>
                      );
                    })}
                  </div>
                ));
              })()}
              {switchError && (
                <div style={{ padding: "6px 10px 8px", fontSize: 10, color: "#ef4444", lineHeight: 1.4 }}>
                  {switchError}
                </div>
              )}
            </div>
          )}
        </div>
        {/* Restore tips */}
        <button
          onClick={() => {
            let cleared = 0;
            for (let i = localStorage.length - 1; i >= 0; i--) {
              const k = localStorage.key(i);
              if (k?.startsWith("hint-")) { localStorage.removeItem(k); cleared++; }
            }
            alert(cleared > 0 ? `Restored ${cleared} tip${cleared === 1 ? "" : "s"} — refresh to see them again.` : "No dismissed tips to restore.");
          }}
          title="Restore dismissed contextual hints"
          style={{
            background: "transparent", border: "1px solid var(--c-border,#1a2235)",
            color: "var(--c-text-muted,#64748b)", borderRadius: 5,
            padding: "4px 8px", fontSize: 9, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 5,
            textTransform: "uppercase", letterSpacing: ".4px", fontWeight: 600,
          }}
        >
          <RotateCcw size={10} aria-hidden="true" />
          Restore tips
        </button>
      </div>
    </nav>
  );
}
