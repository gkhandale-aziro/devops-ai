import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Zap, Home as HomeIcon, LayoutGrid, Bell, Clock, MessageSquare, Settings, Wifi, X, Plus, RotateCcw, ChevronDown, ChevronLeft } from "lucide-react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import type { Target } from "../types";
import { ThemeToggle } from "./ThemeContext";
import { TARGET_META } from "../utils/targetIcons";
import { Pencil } from "lucide-react";
import { api } from "../api/client";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT, SHADOW, Z_INDEX } from "../utils/theme";

interface Props {
  targets:       Target[];
  activeId:      string | null;
  onSelect:      (t: Target) => void;
  onRemove:      (id: string) => void;
  onEdit?:       (t: Target) => void;
  onAddClick:    () => void;
  monitorActive: boolean;
  aiModel:       string;
  onModelChange?: (model: string) => void;
  modelStatus?:  "healthy" | "degraded" | "fallback" | "unavailable";
  collapsed?:    boolean;
  onToggle?:     () => void;
}

// TODO: Move TYPE_COLORS and STATUS_COLORS to theme.ts as canonical color maps
const TYPE_COLORS: Record<string, string> = {
  kubernetes: "#326CE5", ssh: C.status.success, local: C.status.success,
  docker: "#2496ED", aws: "#FF9900", gcp: "#4285F4",
  azure: "#0078D4", terraform: "#7B42BC",
};

const STATUS_COLORS: Record<string, string> = {
  healthy: C.status.success, degraded: C.status.warning, fallback: C.status.warning, unavailable: C.status.danger,
};

const SIDEBAR_EXPANDED = 236;
const SIDEBAR_COLLAPSED = 56;

/** Inline Radix Tooltip — shows label on hover when sidebar is collapsed */
function SidebarTooltip({ label, children, side = "right" }: { label: string; children: ReactNode; side?: "right" | "top" }) {
  return (
    <TooltipPrimitive.Root delayDuration={120}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          style={{
            background: C.bg.elevated,
            color: C.text.primary,
            border: `1px solid ${C.border.muted}`,
            borderRadius: RADIUS.md,
            padding: `${SPACE.xs}px ${SPACE.sm}px`,
            fontSize: FONT_SIZE.sm,
            fontWeight: FONT_WEIGHT.medium,
            boxShadow: SHADOW.md,
            zIndex: Z_INDEX.tooltip,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Sidebar({ targets, activeId, onSelect, onRemove, onEdit, onAddClick, monitorActive, aiModel, onModelChange, modelStatus = "healthy", collapsed = false, onToggle }: Props) {
  const loc = useLocation();
  const nav = useNavigate();
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [availableModels, setAvailableModels] = useState<{ name: string; provider: string }[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [switching, setSwitching] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const collapsedPickerRef = useRef<HTMLDivElement>(null);
  const collapsedModelBtnRef = useRef<HTMLButtonElement>(null);

  // Close picker on outside click — check all possible picker containers
  useEffect(() => {
    if (!showModelPicker) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const insidePicker = pickerRef.current?.contains(target);
      const insideCollapsedPicker = collapsedPickerRef.current?.contains(target);
      const insideCollapsedBtn = collapsedModelBtnRef.current?.contains(target);
      if (!insidePicker && !insideCollapsedPicker && !insideCollapsedBtn) {
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
    const link = (
      <Link
        to={to}
        className="nav-item"
        data-active={active ? "true" : undefined}
        style={{
          display: "flex", alignItems: "center", gap: SPACE.sm,
          padding: collapsed ? `${SPACE.sm - 1}px 0` : `${SPACE.sm - 1}px ${SPACE.md}px`,
          borderRadius: RADIUS.md, fontSize: FONT_SIZE.md,
          color: active ? C.text.primary : C.text.muted,
          background: active ? "var(--c-accent-dim)" : "transparent",
          borderLeft: active ? `2px solid ${C.accent.primary}` : "2px solid transparent",
          textDecoration: "none",
          fontWeight: active ? FONT_WEIGHT.semibold : FONT_WEIGHT.normal,
          justifyContent: collapsed ? "center" : "flex-start",
          position: collapsed ? "relative" as const : undefined,
        }}
      >
        <span style={{ flexShrink: 0, color: active ? C.accent.light : C.text.muted, transition: "color .15s" }}>
          {icon}
        </span>
        {!collapsed && <span style={{ flex: 1 }}>{label}</span>}
        {!collapsed && badge}
        {collapsed && badge && (
          <span style={{ position: "absolute", top: 2, right: 2 }}>{badge}</span>
        )}
      </Link>
    );
    if (collapsed) {
      return <SidebarTooltip key={to} label={label}>{link}</SidebarTooltip>;
    }
    return link;
  };

  const onlineCount = targets.filter(t => t.status === "online").length;

  return (
    <TooltipPrimitive.Provider delayDuration={120}>
    <nav aria-label="Main navigation" style={{
      width: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED,
      background: "var(--c-bg-surface)",
      borderRight: `1px solid ${C.border.muted}`,
      boxShadow: SHADOW.md,
      display: "flex", flexDirection: "column",
      flexShrink: 0, height: "100vh",
      transition: "width 200ms ease-out",
      overflow: "hidden",
    }}>

      {/* ── Logo ───────────────────────────────────────────────────────────── */}
      <div style={{
        padding: collapsed ? `${SPACE.md + 2}px ${SPACE.sm}px ${SPACE.md}px` : `${SPACE.md + 2}px ${SPACE.lg}px ${SPACE.md}px`,
        borderBottom: `1px solid ${C.border.muted}`,
        display: "flex", alignItems: "center", gap: SPACE.sm,
        flexShrink: 0,
        justifyContent: collapsed ? "center" : "flex-start",
      }}>
        {collapsed ? (
          /* Collapsed: logo icon doubles as expand toggle */
          <button
            onClick={onToggle}
            aria-label="Expand sidebar"
            style={{
              width: 30, height: 30, borderRadius: RADIUS.lg,
              background: `linear-gradient(135deg, ${C.accent.primary} 0%, ${C.accent.light} 100%)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, border: "none", cursor: "pointer",
              boxShadow: SHADOW.glow,
              transition: "transform .15s",
            }}
          >
            <Zap size={14} fill="white" stroke="white" />
          </button>
        ) : (
          /* Expanded: logo + title + collapse chevron */
          <>
            <div style={{
              width: 30, height: 30, borderRadius: RADIUS.lg,
              background: `linear-gradient(135deg, ${C.accent.primary} 0%, ${C.accent.light} 100%)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
              boxShadow: SHADOW.glow,
            }}>
              <Zap size={14} fill="white" stroke="white" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: FONT_SIZE.lg, fontWeight: FONT_WEIGHT.black, color: C.text.primary, letterSpacing: "-.3px", lineHeight: 1.2 }}>
                Aziro<span style={{ color: C.accent.primary }}>Ops</span>
              </div>
              <div style={{ fontSize: FONT_SIZE.xs, color: C.text.faint, textTransform: "uppercase", letterSpacing: ".7px", marginTop: 1, fontWeight: FONT_WEIGHT.medium }}>
                DevOps AI Platform
              </div>
            </div>
            <button
              onClick={onToggle}
              aria-label="Collapse sidebar"
              className="hover-bg-raised"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: C.text.faint, padding: SPACE.xs,
                borderRadius: RADIUS.sm, display: "flex", alignItems: "center", justifyContent: "center",
                transition: "color .15s, background .15s",
                flexShrink: 0,
              }}
            >
              <ChevronLeft size={14} />
            </button>
          </>
        )}
      </div>

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <div style={{ padding: `${SPACE.md - 6}px ${SPACE.sm}px`, display: "flex", flexDirection: "column", gap: SPACE.xxs, flexShrink: 0 }}>
        {navItem("/", "Home", <HomeIcon size={15} />)}
        {navItem("/dashboard", "Dashboard", <LayoutGrid size={15} />)}
        {navItem("/alerts", "Live Alerts", <Bell size={15} />,
          monitorActive && (
            <span style={{
              width: 7, height: 7, borderRadius: RADIUS.pill,
              background: C.status.success, animation: "pulse 1.5s infinite",
              display: "inline-block", boxShadow: `0 0 6px ${C.status.success}`,
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
        padding: collapsed ? `${SPACE.sm + 2}px ${SPACE.sm}px ${SPACE.md - 6}px` : `${SPACE.sm + 2}px ${SPACE.lg}px ${SPACE.md - 6}px`,
        borderTop: `1px solid ${C.border.muted}`,
        display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between",
        flexShrink: 0,
      }}>
        {collapsed ? (
          <span style={{
            fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.bold,
            color: onlineCount > 0 ? C.status.success : C.text.faint,
          }}>
            {onlineCount}/{targets.length}
          </span>
        ) : (
          <>
            <span style={{ fontSize: FONT_SIZE.xs, color: C.text.faint, textTransform: "uppercase", letterSpacing: ".9px", fontWeight: FONT_WEIGHT.bold }}>
              Connections
            </span>
            {targets.length > 0 && (
              <span style={{
                fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.bold,
                background: onlineCount > 0 ? `${C.status.success}18` : "var(--c-bg-overlay)",
                color: onlineCount > 0 ? C.status.success : C.text.faint,
                border: `1px solid ${onlineCount > 0 ? `${C.status.success}33` : C.border.muted}`,
                borderRadius: RADIUS.sm, padding: `1px ${SPACE.sm + 3}px`,
              }}>
                {onlineCount}/{targets.length}
              </span>
            )}
          </>
        )}
      </div>

      {/* ── Connection list (scrollable, takes remaining space) ────────────── */}
      <div style={{ flex: 1, overflowY: "auto", padding: `0 ${SPACE.sm}px ${SPACE.md - 6}px`, minHeight: 0 }}>

        {targets.length === 0 && !collapsed && (
          <div style={{ padding: `${SPACE.xl}px ${SPACE.md}px`, textAlign: "center" }}>
            <div style={{
              width: 36, height: 36, borderRadius: RADIUS.lg,
              background: "var(--c-bg-overlay)",
              border: `1px solid ${C.border.muted}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: `0 auto ${SPACE.sm}px`,
            }}>
              <Wifi size={16} stroke={C.text.faint} strokeWidth={1.5} />
            </div>
            <div style={{ fontSize: FONT_SIZE.md, fontWeight: FONT_WEIGHT.semibold, color: C.text.secondary, marginBottom: 3 }}>No connections yet</div>
            <div style={{ fontSize: FONT_SIZE.xs, color: C.text.faint, lineHeight: 1.5 }}>Add a target below</div>
          </div>
        )}

        {targets.map(t => {
          const isActive  = t.id === activeId;
          const dotColor  = t.status === "online" ? C.status.success : t.status === "offline" ? C.status.danger : C.text.muted;
          const typeColor = TYPE_COLORS[t.type] ?? C.status.neutral;

          /* ── Collapsed: icon-only with tooltip ── */
          if (collapsed) {
            const badge = (
              <div
                key={t.id}
                onClick={() => { onSelect(t); nav("/dashboard"); }}
                style={{
                  width: 34, height: 34, borderRadius: RADIUS.md, cursor: "pointer",
                  background: isActive ? "var(--c-accent-dim)" : "transparent",
                  border: `1px solid ${isActive ? `${C.accent.primary}33` : "transparent"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: `0 auto ${SPACE.xxs}px`, position: "relative",
                  transition: "all .15s", color: typeColor,
                }}
                className={!isActive ? "hover-bg-raised" : undefined}
              >
                {(() => { const meta = TARGET_META[t.type as keyof typeof TARGET_META]; if (meta) { const Icon = meta.icon; return <Icon size={FONT_SIZE.md} />; } return <span style={{ fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.black }}>{t.type.slice(0, 3).toUpperCase()}</span>; })()}
                {/* Status dot overlay */}
                <span style={{
                  position: "absolute", bottom: -1, right: -1,
                  width: 6, height: 6, borderRadius: RADIUS.pill,
                  background: dotColor,
                  boxShadow: t.status === "online" ? `0 0 4px ${dotColor}` : "none",
                  border: "1.5px solid var(--c-bg-surface)",
                }} />
              </div>
            );
            return <SidebarTooltip key={t.id} label={`${t.name} (${t.status ?? "unknown"})`}>{badge}</SidebarTooltip>;
          }

          /* ── Expanded: full connection row ── */
          return (
            <div
              key={t.id}
              className="conn-row"
              onClick={() => { onSelect(t); nav("/dashboard"); }}
              style={{
                display: "flex", alignItems: "center", gap: SPACE.sm,
                padding: `${SPACE.sm - 1}px ${SPACE.sm}px`, borderRadius: RADIUS.lg, cursor: "pointer",
                marginBottom: SPACE.xxs, transition: "all .15s",
                background: isActive ? "var(--c-accent-dim)" : "transparent",
                border: `1px solid ${isActive ? `${C.accent.primary}33` : "transparent"}`,
                boxShadow: isActive ? SHADOW.sm : "none",
              }}
            >
              {/* Type badge */}
              <div style={{
                width: 28, height: 28, borderRadius: RADIUS.md, flexShrink: 0,
                background: `${typeColor}18`,
                border: `1px solid ${typeColor}33`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: typeColor,
              }}>
                {(() => { const meta = TARGET_META[t.type as keyof typeof TARGET_META]; if (meta) { const Icon = meta.icon; return <Icon size={FONT_SIZE.md} />; } return <span style={{ fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.black, letterSpacing: ".4px" }}>{t.type.slice(0, 3).toUpperCase()}</span>; })()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: FONT_SIZE.md, fontWeight: isActive ? FONT_WEIGHT.bold : FONT_WEIGHT.medium,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: isActive ? C.text.primary : C.text.secondary,
                  display: "flex", alignItems: "center", gap: SPACE.xs,
                }}>
                  {t.name}
                  {t.type === "local" && (
                    <span style={{ fontSize: FONT_SIZE.xs, color: C.status.success, fontWeight: FONT_WEIGHT.black, background: `${C.status.success}18`, border: `1px solid ${C.status.success}33`, padding: `0px ${SPACE.xs}px`, borderRadius: RADIUS.sm, letterSpacing: ".3px", flexShrink: 0 }}>
                      LOCAL
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: SPACE.xs, marginTop: SPACE.xxs }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: RADIUS.pill, background: dotColor,
                    boxShadow: t.status === "online" ? `0 0 5px ${dotColor}` : "none",
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: FONT_SIZE.xs, color: dotColor, fontWeight: FONT_WEIGHT.semibold }}>{t.status ?? "unknown"}</span>
                </div>
              </div>

              {onEdit && (
                <button
                  onClick={e => { e.stopPropagation(); onEdit(t); }}
                  aria-label="Edit connection"
                  className="conn-action hover-text-accent"
                  style={{
                    background: "none", border: "none",
                    color: C.text.faint,
                    cursor: "pointer", padding: "3px", borderRadius: RADIUS.sm,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Pencil size={FONT_SIZE.sm} strokeWidth={2.5} />
                </button>
              )}
              <button
                onClick={e => { e.stopPropagation(); onRemove(t.id); }}
                aria-label="Remove connection"
                className="conn-action hover-text-danger"
                style={{
                  background: "none", border: "none",
                  color: C.text.faint,
                  cursor: "pointer", padding: "3px", borderRadius: RADIUS.sm,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={FONT_SIZE.sm} strokeWidth={2.5} />
              </button>
            </div>
          );
        })}

        {/* Add connection button */}
        {collapsed ? (
          <SidebarTooltip label="Add Connection">
            <button
              data-tour="add-connection"
              onClick={onAddClick}
              className="hover-bg-accent-dim"
              style={{
                width: 34, height: 34, margin: `${SPACE.xs}px auto 0`,
                background: "transparent",
                border: `1px solid ${C.border.strong}`,
                borderRadius: RADIUS.md,
                color: C.accent.primary,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all .15s",
              }}
            >
              <Plus size={FONT_SIZE.md} strokeWidth={2.5} />
            </button>
          </SidebarTooltip>
        ) : (
          <button
            data-tour="add-connection"
            onClick={onAddClick}
            className="hover-bg-accent-dim hover-border-accent hover-glow-accent"
            style={{
              width: "100%", marginTop: targets.length > 0 ? SPACE.xs : SPACE.xxs,
              padding: `${SPACE.sm}px ${SPACE.md}px`,
              background: "transparent",
              border: `1px solid ${C.border.strong}`,
              borderRadius: RADIUS.lg,
              color: C.accent.primary,
              fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.semibold,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: SPACE.md - 6,
              transition: "all .15s",
            }}
          >
            <Plus size={FONT_SIZE.md} strokeWidth={2.5} />
            Add Connection
          </button>
        )}
      </div>

      {/* ── Footer — compact: model + theme + tips in one row ─────────────── */}
      <div style={{
        borderTop: `1px solid ${C.border.muted}`,
        padding: collapsed ? `${SPACE.sm}px ${SPACE.xs}px` : `${SPACE.sm}px ${SPACE.md}px`,
        flexShrink: 0,
        display: "flex", flexDirection: "column", gap: SPACE.md - 6,
        alignItems: collapsed ? "center" : "stretch",
      }}>
        {collapsed ? (
          /* Collapsed footer: status dot + theme toggle stacked */
          <div ref={pickerRef} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: SPACE.md - 6, position: "relative" }}>
            <SidebarTooltip label={aiModel ? aiModel.replace(/^(gemini|ollama|openai|anthropic)\//, "") : "AI Model"}>
              <button
                ref={collapsedModelBtnRef}
                onClick={openModelPicker}
                className="hover-bg-raised"
                style={{
                  width: 34, height: 34, borderRadius: RADIUS.md,
                  background: "none", border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "background .15s",
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: RADIUS.pill,
                  background: STATUS_COLORS[modelStatus] ?? C.status.success,
                  boxShadow: `0 0 6px ${STATUS_COLORS[modelStatus] ?? C.status.success}88`,
                  animation: "pulse 2s infinite",
                }} />
              </button>
            </SidebarTooltip>
            <ThemeToggle />
            {/* Collapsed model picker — position:fixed to escape overflow:hidden */}
            {showModelPicker && (() => {
              const rect = collapsedModelBtnRef.current?.getBoundingClientRect();
              const fixedLeft = (rect?.right ?? SIDEBAR_COLLAPSED) + 6;
              const fixedBottom = window.innerHeight - (rect?.bottom ?? 0);
              return (
                <div ref={collapsedPickerRef} style={{
                  position: "fixed", bottom: fixedBottom, left: fixedLeft,
                  width: 220, background: C.bg.elevated,
                  border: `1px solid ${C.border.muted}`, borderRadius: RADIUS.lg,
                  boxShadow: SHADOW.lg, zIndex: Z_INDEX.dropdown,
                  maxHeight: 280, overflowY: "auto",
                }}>
                  <div style={{ padding: `${SPACE.sm}px ${SPACE.sm + 2}px ${SPACE.xs}px`, fontSize: FONT_SIZE.xs, color: C.text.faint, textTransform: "uppercase", letterSpacing: ".6px", fontWeight: FONT_WEIGHT.bold }}>
                    Select Model
                  </div>
                  {modelLoading ? (
                    <div style={{ padding: `${SPACE.md}px ${SPACE.sm + 2}px`, fontSize: FONT_SIZE.sm, color: C.text.muted, textAlign: "center" }}>Loading…</div>
                  ) : availableModels.length === 0 ? (
                    <div style={{ padding: `${SPACE.md}px ${SPACE.sm + 2}px`, fontSize: FONT_SIZE.sm, color: C.text.muted, textAlign: "center" }}>No models found</div>
                  ) : (() => {
                    const groups = new Map<string, { name: string; provider: string }[]>();
                    for (const m of availableModels) {
                      const list = groups.get(m.provider) ?? [];
                      list.push(m);
                      groups.set(m.provider, list);
                    }
                    return Array.from(groups.entries()).map(([provider, models]) => (
                      <div key={provider}>
                        <div style={{ padding: `${SPACE.md - 6}px ${SPACE.sm + 2}px ${SPACE.xxs}px`, fontSize: FONT_SIZE.xs, color: C.text.faint, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: FONT_WEIGHT.bold }}>
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
                              className={!isActive && !switching ? "hover-bg-surface" : undefined}
                              style={{
                                display: "flex", alignItems: "center", gap: SPACE.sm, width: "100%",
                                padding: `${SPACE.sm - 1}px ${SPACE.sm + 2}px`, background: isActive ? "var(--c-accent-dim)" : "transparent",
                                border: "none", borderLeft: isActive ? `2px solid ${C.accent.primary}` : "2px solid transparent",
                                cursor: switching ? "wait" : "pointer", transition: "background .1s", textAlign: "left",
                                opacity: switching && !isSwitching ? 0.5 : 1,
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: FONT_SIZE.sm, fontWeight: isActive ? FONT_WEIGHT.semibold : FONT_WEIGHT.normal, color: isActive ? C.text.primary : C.text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {isSwitching ? "Switching…" : display}
                                </div>
                              </div>
                              {isActive && <span style={{ width: 5, height: 5, borderRadius: RADIUS.pill, background: C.status.success, flexShrink: 0 }} />}
                            </button>
                          );
                        })}
                      </div>
                    ));
                  })()}
                  {switchError && (
                    <div style={{ padding: `${SPACE.md - 6}px ${SPACE.sm + 2}px ${SPACE.sm}px`, fontSize: FONT_SIZE.xs, color: C.status.danger, lineHeight: 1.4 }}>
                      {switchError}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ) : (
          /* Expanded footer: full model picker + theme + restore tips */
          <>
            <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm, position: "relative" }} ref={pickerRef}>
              {aiModel && (
                <button
                  data-tour="model-picker"
                  onClick={openModelPicker}
                  className="hover-bg-raised hover-border-strong"
                  style={{
                    display: "flex", alignItems: "center", gap: SPACE.md - 6, flex: 1, minWidth: 0,
                    background: "none", border: "1px solid transparent", borderRadius: RADIUS.sm,
                    padding: `3px ${SPACE.md - 6}px`, cursor: "pointer", transition: "all .15s",
                  }}
                  title="Click to change AI model"
                >
                  <span style={{
                    width: 6, height: 6, borderRadius: RADIUS.pill,
                    background: STATUS_COLORS[modelStatus] ?? C.status.success,
                    boxShadow: `0 0 6px ${STATUS_COLORS[modelStatus] ?? C.status.success}88`,
                    flexShrink: 0, animation: "pulse 2s infinite",
                  }} />
                  <div style={{
                    fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.semibold,
                    color: C.accent.light,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    flex: 1, textAlign: "left",
                  }}>
                    {aiModel.replace("gemini/", "").replace("ollama/", "").replace("openai/", "")}
                  </div>
                  <ChevronDown size={FONT_SIZE.xs} color={C.text.faint} style={{ flexShrink: 0 }} />
                </button>
              )}
              <ThemeToggle />

              {/* Model picker dropdown */}
              {showModelPicker && (
                <div style={{
                  position: "absolute", bottom: "100%", left: 0, right: 0,
                  marginBottom: SPACE.xs, background: C.bg.elevated,
                  border: `1px solid ${C.border.muted}`, borderRadius: RADIUS.lg,
                  boxShadow: SHADOW.lg, zIndex: Z_INDEX.dropdown,
                  maxHeight: 240, overflowY: "auto",
                }}>
                  <div style={{ padding: `${SPACE.sm}px ${SPACE.sm + 2}px ${SPACE.xs}px`, fontSize: FONT_SIZE.xs, color: C.text.faint, textTransform: "uppercase", letterSpacing: ".6px", fontWeight: FONT_WEIGHT.bold }}>
                    Select Model
                  </div>
                  {modelLoading ? (
                    <div style={{ padding: `${SPACE.md}px ${SPACE.sm + 2}px`, fontSize: FONT_SIZE.sm, color: C.text.muted, textAlign: "center" }}>Loading…</div>
                  ) : availableModels.length === 0 ? (
                    <div style={{ padding: `${SPACE.md}px ${SPACE.sm + 2}px`, fontSize: FONT_SIZE.sm, color: C.text.muted, textAlign: "center" }}>No models found</div>
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
                        <div style={{ padding: `${SPACE.md - 6}px ${SPACE.sm + 2}px ${SPACE.xxs}px`, fontSize: FONT_SIZE.xs, color: C.text.faint, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: FONT_WEIGHT.bold }}>
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
                              className={!isActive && !switching ? "hover-bg-surface" : undefined}
                              style={{
                                display: "flex", alignItems: "center", gap: SPACE.sm, width: "100%",
                                padding: `${SPACE.sm - 1}px ${SPACE.sm + 2}px`, background: isActive ? "var(--c-accent-dim)" : "transparent",
                                border: "none", borderLeft: isActive ? `2px solid ${C.accent.primary}` : "2px solid transparent",
                                cursor: switching ? "wait" : "pointer", transition: "background .1s", textAlign: "left",
                                opacity: switching && !isSwitching ? 0.5 : 1,
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: FONT_SIZE.sm, fontWeight: isActive ? FONT_WEIGHT.semibold : FONT_WEIGHT.normal, color: isActive ? C.text.primary : C.text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {isSwitching ? "Switching…" : display}
                                </div>
                              </div>
                              {isActive && <span style={{ width: 5, height: 5, borderRadius: RADIUS.pill, background: C.status.success, flexShrink: 0 }} />}
                            </button>
                          );
                        })}
                      </div>
                    ));
                  })()}
                  {switchError && (
                    <div style={{ padding: `${SPACE.md - 6}px ${SPACE.sm + 2}px ${SPACE.sm}px`, fontSize: FONT_SIZE.xs, color: C.status.danger, lineHeight: 1.4 }}>
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
              className="hover-bg-raised"
              style={{
                background: "transparent", border: `1px solid ${C.border.muted}`,
                color: C.text.muted, borderRadius: RADIUS.sm,
                padding: `${SPACE.xs}px ${SPACE.sm}px`, fontSize: FONT_SIZE.xs, cursor: "pointer",
                display: "flex", alignItems: "center", gap: SPACE.xs + 1,
                textTransform: "uppercase", letterSpacing: ".4px", fontWeight: FONT_WEIGHT.semibold,
                transition: "background .15s",
              }}
            >
              <RotateCcw size={FONT_SIZE.xs} aria-hidden="true" />
              Restore tips
            </button>
          </>
        )}
      </div>
    </nav>
    </TooltipPrimitive.Provider>
  );
}
