/**
 * ResourceGraph.tsx — Visual K8s resource topology graph.
 * Shows Deployment → Pods → Services → Ingresses as connected nodes.
 * Pure CSS/SVG — no external graph library needed.
 *
 * Features:
 * - Pan (drag on background) + zoom (wheel / toolbar buttons)
 * - Live status updates via monitor SSE (matched by object+namespace)
 * - Health propagation: unhealthy pod → warning ring on upstream
 *   deployment/service/ingress
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Target, SSEEvent } from "../types";
import { api } from "../api/client";
import { useMonitorSSE } from "../hooks/useSSE";
import { ZoomIn, ZoomOut, RotateCcw, RefreshCw, Activity } from "lucide-react";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT } from "../utils/theme";

interface Props {
  target:    Target;
  namespace: string;
}

interface Node {
  id:        string;
  kind:      "deployment" | "pod" | "service" | "ingress";
  name:      string;
  namespace: string;
  status:    string;
  x:         number;
  y:         number;
  width:     number;
  height:    number;
}

interface Edge { from: string; to: string }

// TODO: move to theme.ts
const KIND_COLOR: Record<string, { bg: string; border: string; text: string }> = {
  deployment: { bg: "#1a1040", border: "var(--c-accent)", text: C.accent.light },
  pod:        { bg: "#0a1a14", border: C.status.success, text: "#4ade80" },
  service:    { bg: "#1a1100", border: C.status.warning, text: "#fbbf24" },
  ingress:    { bg: "#0c1a2a", border: C.status.info, text: "#22d3ee" },
};

// TODO: move to theme.ts
const POD_STATUS_COLOR: Record<string, string> = {
  Running:           C.status.success,
  Completed:         C.status.info,
  Pending:           C.status.warning,
  CrashLoopBackOff:  C.status.danger,
  Error:             C.status.danger,
  OOMKilled:         C.status.danger,
  ImagePullBackOff:  "#f97316",
};

const NODE_W = 160;
const NODE_H = 48;
const COL_GAP = 60;
const ROW_GAP = SPACE.md;

// Pod phase values that indicate a hard failure — propagate upstream.
// Deliberately excludes "Pending" (transient on startup) and "Unknown"
// (parser fallback); those would produce noisy false-positive warnings.
const UNHEALTHY_STATUS = new Set([
  "CrashLoopBackOff", "Error", "OOMKilled", "ImagePullBackOff",
  "ErrImagePull", "Failed", "CreateContainerConfigError", "Init:Error",
]);

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.15;

export function ResourceGraph({ target, namespace }: Props) {
  const [nodes,    setNodes]    = useState<Node[]>([]);
  const [edges,    setEdges]    = useState<Edge[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");
  const [hovered,  setHovered]  = useState<string | null>(null);
  const [selected, setSelected] = useState<Node | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Zoom / pan viewport. Applied as a transform on a <g> wrapper.
  const [zoom, setZoom] = useState(1);
  const [pan,  setPan]  = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // Live-update indicator: flashes when an SSE alert touches a node.
  const [lastLive, setLastLive] = useState<number>(0);
  const [reloadKey, setReloadKey] = useState(0);

  // Keep a ref of the current nodes so SSE handler can look up without
  // re-binding the callback on every state update.
  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;

  const refetch = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    setLoading(true);
    setError("");
    api.topology(target.id, namespace || undefined)
      .then(data => {
        const ns: Node[] = [];
        const es: Edge[] = [];

        // Column positions
        const COL = [40, 40 + NODE_W + COL_GAP, 40 + (NODE_W + COL_GAP) * 2, 40 + (NODE_W + COL_GAP) * 3];

        // Layer 1: Ingresses
        data.ingresses.slice(0, 8).forEach((ing, i) => {
          ns.push({ id: `ing-${ing.name}`, kind: "ingress", name: ing.name, namespace: ing.namespace, status: ing.hosts || "—", x: COL[0], y: 40 + i * (NODE_H + ROW_GAP), width: NODE_W, height: NODE_H });
        });

        // Layer 2: Services
        data.services.filter(s => s.name !== "kubernetes").slice(0, 12).forEach((svc, i) => {
          const id = `svc-${svc.name}-${svc.namespace}`;
          ns.push({ id, kind: "service", name: svc.name, namespace: svc.namespace, status: svc.type, x: COL[1], y: 40 + i * (NODE_H + ROW_GAP), width: NODE_W, height: NODE_H });
          // Connect ingresses to services (by namespace + name/host heuristic)
          data.ingresses.forEach(ing => {
            if (ing.namespace !== svc.namespace) return;
            // Match if ingress hosts contain service name, or names share a common prefix
            const ingBase = ing.name.split("-")[0];
            const svcBase = svc.name.split("-")[0];
            if (ing.hosts?.includes(svc.name) || ingBase === svcBase || ing.name.includes(svc.name) || svc.name.includes(ing.name)) {
              es.push({ from: `ing-${ing.name}`, to: id });
            }
          });
        });

        // Layer 3: Deployments
        data.deployments.slice(0, 12).forEach((dep, i) => {
          const id = `dep-${dep.name}-${dep.namespace}`;
          ns.push({ id, kind: "deployment", name: dep.name, namespace: dep.namespace, status: dep.ready, x: COL[2], y: 40 + i * (NODE_H + ROW_GAP), width: NODE_W, height: NODE_H });
          // Connect services to deployments (by name heuristic)
          data.services.forEach(svc => {
            const svcId = `svc-${svc.name}-${svc.namespace}`;
            if (svc.namespace === dep.namespace && (svc.name.includes(dep.name.split("-")[0]) || dep.name.includes(svc.name.split("-")[0]))) {
              es.push({ from: svcId, to: id });
            }
          });
        });

        // Layer 4: Pods — group under deployment
        const depMap: Record<string, Node[]> = {};
        data.pods.slice(0, 40).forEach(pod => {
          // Match pod to deployment by prefix
          const depNode = ns.find(n => n.kind === "deployment" && n.namespace === pod.namespace && pod.name.startsWith(n.name.split("-").slice(0, 2).join("-")));
          const key = depNode?.id ?? `orphan-${pod.namespace}`;
          depMap[key] = depMap[key] ?? [];
          depMap[key].push({ id: `pod-${pod.name}`, kind: "pod", name: pod.name, namespace: pod.namespace, status: pod.status, x: 0, y: 0, width: NODE_W, height: NODE_H });
        });

        let podY = 40;
        Object.entries(depMap).forEach(([depId, pods]) => {
          const depNode = ns.find(n => n.id === depId);
          const startY = depNode?.y ?? podY;
          pods.slice(0, 5).forEach((pod, pi) => {
            pod.x = COL[3];
            pod.y = startY + pi * (NODE_H + ROW_GAP);
            ns.push(pod);
            es.push({ from: depId, to: pod.id });
          });
        });

        setNodes(ns);
        setEdges(es);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [target.id, namespace, reloadKey]);

  // ── Health propagation ─────────────────────────────────────────────
  // BFS upstream from any unhealthy pod, marking every ancestor (deployment,
  // service, ingress) as "degraded" so we can render a warning ring. This is
  // what makes the topology actually useful: a red pod taints the chain above.
  const degradedIds = useMemo(() => {
    const out = new Set<string>();
    const parents: Record<string, string[]> = {};
    edges.forEach(e => { (parents[e.to] ??= []).push(e.from); });

    const queue: string[] = [];
    nodes.forEach(n => {
      if (n.kind === "pod" && UNHEALTHY_STATUS.has(n.status)) {
        out.add(n.id);
        queue.push(n.id);
      }
    });
    while (queue.length) {
      const id = queue.shift()!;
      (parents[id] ?? []).forEach(p => {
        if (!out.has(p)) { out.add(p); queue.push(p); }
      });
    }
    return out;
  }, [nodes, edges]);

  // ── Live SSE updates ───────────────────────────────────────────────
  // When a monitor alert fires for a pod we already have on the graph,
  // update its status in place and flash the Live indicator. For objects
  // we don't know about yet (new pods, new namespaces), trigger a
  // debounced refetch so the topology stays current.
  //
  // Look up the target via nodesRef BEFORE calling setNodes so the
  // updater stays pure (no side effects from within setState).
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSSE = useCallback((ev: SSEEvent) => {
    if (ev.type !== "monitor_alert") return;
    const { object, namespace: ns, reason } = ev;
    const match = nodesRef.current.find(n =>
      n.kind === "pod" && n.namespace === ns &&
      (n.name === object || object.startsWith(n.name))
    );
    if (match) {
      setNodes(prev => prev.map(n =>
        n.id === match.id ? { ...n, status: reason || n.status } : n
      ));
    } else {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(refetch, 2500);
    }
    setLastLive(Date.now());
  }, [refetch]);

  useMonitorSSE(target.type === "kubernetes", handleSSE);

  useEffect(() => () => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
  }, []);

  // ── Zoom / pan handlers ────────────────────────────────────────────
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setZoom(prevZoom => {
      const next = clamp(prevZoom * factor, ZOOM_MIN, ZOOM_MAX);
      if (next === prevZoom) return prevZoom;
      // Preserve world coord under cursor, if provided.
      if (cx !== undefined && cy !== undefined) {
        setPan(prevPan => {
          const wx = (cx - prevPan.x) / prevZoom;
          const wy = (cy - prevPan.y) / prevZoom;
          return { x: cx - wx * next, y: cy - wy * next };
        });
      }
      return next;
    });
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    // Note: React 17+ attaches wheel as a passive listener, so we can't
    // call preventDefault here. The parent container has overflow:hidden
    // which suppresses scroll bleed, so that's OK in practice.
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    zoomAt(factor, cx, cy);
  }, [zoomAt]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only pan when the background is dragged — let node clicks pass through.
    const el = e.target as Element;
    if (el.closest("[data-topo-node]")) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  }, [pan.x, pan.y]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  // Keyboard shortcuts: +/- zoom, 0 reset (when topology is focused).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "+" || e.key === "=") { zoomAt(ZOOM_STEP); }
      else if (e.key === "-" || e.key === "_") { zoomAt(1 / ZOOM_STEP); }
      else if (e.key === "0") { resetView(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomAt, resetView]);

  // Live indicator flash duration. Reset to 0 after the window elapses
  // so the icon dims back to idle (next alert bumps it up again).
  const isLive = lastLive > 0 && Date.now() - lastLive < 4000;
  useEffect(() => {
    if (lastLive === 0) return;
    const t = setTimeout(() => setLastLive(0), 4100);
    return () => clearTimeout(t);
  }, [lastLive]);

  if (loading) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: SPACE.sm, color: C.text.muted, fontSize: FONT_SIZE.md }}>
      <span style={{ width: 14, height: 14, border: "2px solid var(--c-border)", borderTopColor: "var(--c-accent)", borderRadius: "50%", animation: "spin .7s linear infinite", display: "inline-block" }} />
      Building topology…
    </div>
  );

  if (error) return (
    <div style={{ padding: SPACE.xl, color: "var(--c-sev1)", fontSize: FONT_SIZE.md }}>kubectl not available or no resources found.</div>
  );

  if (nodes.length === 0) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.text.faint, fontSize: FONT_SIZE.md }}>
      No resources found in {namespace || "any namespace"}.
    </div>
  );

  const getCenter = (n: Node) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });

  const ctrlBtn: React.CSSProperties = {
    width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
    background: "var(--c-bg-surface)", border: "1px solid var(--c-border)", borderRadius: RADIUS.sm,
    color: C.text.muted, cursor: "pointer", padding: 0,
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Legend + zoom toolbar */}
      <div style={{ padding: `${SPACE.sm}px ${SPACE.lg}px`, borderBottom: `1px solid ${C.border.muted}`, display: "flex", gap: SPACE.lg, alignItems: "center", flexShrink: 0, background: C.bg.panel }}>
        <span style={{ fontSize: FONT_SIZE.sm, color: C.text.faint, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: FONT_WEIGHT.bold }}>Topology</span>
        {(["ingress", "service", "deployment", "pod"] as const).map(kind => {
          const c = KIND_COLOR[kind];
          return (
            <div key={kind} style={{ display: "flex", alignItems: "center", gap: SPACE.xs }}>
              <span style={{ width: 8, height: 8, borderRadius: RADIUS.sm / 2, background: c.border, display: "inline-block" }} />
              <span style={{ fontSize: FONT_SIZE.sm, color: C.text.muted, textTransform: "capitalize" }}>{kind}</span>
            </div>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: SPACE.xs }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--c-sev2)", display: "inline-block", boxShadow: "0 0 6px var(--c-sev2)" }} />
          <span style={{ fontSize: FONT_SIZE.sm, color: C.text.muted }}>degraded</span>
        </div>

        <span style={{ marginLeft: "auto", fontSize: FONT_SIZE.sm, color: C.text.faint }}>{nodes.length} resources</span>

        {/* Live indicator */}
        {target.type === "kubernetes" && (
          <div style={{
            display: "flex", alignItems: "center", gap: SPACE.xs, fontSize: FONT_SIZE.sm,
            color: isLive ? "var(--c-accent)" : C.text.faint,
            transition: "color .3s",
          }} title="Live updates from monitor stream">
            <Activity size={12} style={{ animation: isLive ? "pulse 1s ease-in-out" : undefined }} />
            <span>live</span>
          </div>
        )}

        {/* Zoom controls */}
        <div style={{ display: "flex", gap: SPACE.xs, alignItems: "center", paddingLeft: SPACE.sm, borderLeft: `1px solid ${C.border.muted}` }}>
          <button type="button" onClick={() => zoomAt(1 / ZOOM_STEP)} style={ctrlBtn} aria-label="Zoom out" title="Zoom out (−)">
            <ZoomOut size={13} />
          </button>
          <span style={{ fontSize: FONT_SIZE.xs, color: C.text.muted, minWidth: 34, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
            {Math.round(zoom * 100)}%
          </span>
          <button type="button" onClick={() => zoomAt(ZOOM_STEP)} style={ctrlBtn} aria-label="Zoom in" title="Zoom in (+)">
            <ZoomIn size={13} />
          </button>
          <button type="button" onClick={resetView} style={ctrlBtn} aria-label="Reset view" title="Reset view (0)">
            <RotateCcw size={13} />
          </button>
          <button type="button" onClick={refetch} style={ctrlBtn} aria-label="Refresh topology" title="Refresh topology">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* SVG Graph */}
      <div
        style={{
          flex: 1, overflow: "hidden", padding: 0, background: "var(--c-bg-panel)",
          cursor: dragging ? "grabbing" : "grab", userSelect: "none",
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg ref={svgRef} width="100%" height="100%" style={{ display: "block" }}>
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="var(--c-border-strong)" />
            </marker>
            <marker id="arrow-warn" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="var(--c-sev2)" />
            </marker>
          </defs>

          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* Edges */}
          {edges.map((e, i) => {
            const from = nodes.find(n => n.id === e.from);
            const to   = nodes.find(n => n.id === e.to);
            if (!from || !to) return null;
            const f = getCenter(from);
            const t = getCenter(to);
            const mx = (f.x + t.x) / 2;
            const isHov = hovered === from.id || hovered === to.id;
            // Degraded edge: both ends are in the propagated set.
            const isDegraded = degradedIds.has(from.id) && degradedIds.has(to.id);
            const stroke = isDegraded ? "var(--c-sev2)" : isHov ? "var(--c-accent)" : "var(--c-border)";
            return (
              <path
                key={i}
                d={`M${f.x + from.width / 2 - 10},${f.y} C${mx},${f.y} ${mx},${t.y} ${t.x - to.width / 2 + 10},${t.y}`}
                fill="none"
                stroke={stroke}
                strokeWidth={isHov || isDegraded ? 1.5 : 1}
                strokeDasharray={isDegraded ? "4 3" : undefined}
                markerEnd={isDegraded ? "url(#arrow-warn)" : "url(#arrow)"}
                style={{ transition: "stroke .15s" }}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map(n => {
            const c     = KIND_COLOR[n.kind];
            const isHov = hovered === n.id;
            const isSel = selected?.id === n.id;
            const isDegraded = degradedIds.has(n.id);
            const statusColor = n.kind === "pod" ? (POD_STATUS_COLOR[n.status] ?? "var(--c-text-muted)") : c.border;
            const shortName = n.name.length > 18 ? n.name.slice(0, 17) + "…" : n.name;
            // Warning ring for degraded ancestors (non-pods). Pods already
            // show their status via statusColor dot — no need to double up.
            const showWarnRing = isDegraded && n.kind !== "pod";

            return (
              <g
                key={n.id}
                data-topo-node
                onClick={() => setSelected(isSel ? null : n)}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}
              >
                {/* Warning ring — degraded propagation */}
                {showWarnRing && (
                  <rect x={n.x - 3} y={n.y - 3} width={n.width + 6} height={n.height + 6} rx={10}
                    fill="none" stroke="var(--c-sev2)" strokeWidth={1.5} strokeDasharray="3 2" opacity={0.85} />
                )}
                {/* Shadow */}
                {(isHov || isSel) && (
                  <rect x={n.x - 2} y={n.y - 2} width={n.width + 4} height={n.height + 4} rx={9}
                    fill="none" stroke={c.border} strokeWidth={2} opacity={0.4} />
                )}
                {/* Card */}
                <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={RADIUS.lg}
                  fill={c.bg} stroke={isSel ? c.border : isHov ? c.border + "88" : "var(--c-border)"} strokeWidth={isSel ? 2 : 1} />
                {/* Left accent bar */}
                <rect x={n.x} y={n.y + 8} width={3} height={n.height - 16} rx={2} fill={c.border} />
                {/* Status dot */}
                <circle cx={n.x + n.width - 12} cy={n.y + n.height / 2} r={4} fill={statusColor} />
                {/* Kind label */}
                <text x={n.x + 14} y={n.y + 16} fontSize={FONT_SIZE.xs} fill={c.text} fontWeight={FONT_WEIGHT.bold} style={{ textTransform: "uppercase", letterSpacing: ".5px" }}>
                  {n.kind}
                </text>
                {/* Name */}
                <text x={n.x + 14} y={n.y + 32} fontSize={FONT_SIZE.sm} fill={C.text.secondary} fontWeight={FONT_WEIGHT.medium}>
                  {shortName}
                </text>
              </g>
            );
          })}
          </g>
        </svg>
      </div>

      {/* Selected node detail panel */}
      {selected && (
        <TopologyDetail target={target} node={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ── Topology detail panel (shows describe/logs on click) ──────────────────────

function TopologyDetail({ target, node, onClose }: { target: Target; node: Node; onClose: () => void }) {
  const [tab, setTab]       = useState<"info" | "describe" | "logs">("info");
  const [detail, setDetail] = useState<Record<string, string>>({});
  const [loading, setLoad]  = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (Object.keys(detail).length > 0) return;
    setLoad(true);
    try {
      const d = await api.resource(target.id, node.kind, node.name, node.namespace);
      setDetail(d);
    } finally {
      setLoad(false);
    }
  }, [target.id, node.id]);

  useEffect(() => { if (tab !== "info") fetchDetail(); }, [tab]);

  const statusColor = POD_STATUS_COLOR[node.status] ?? "var(--c-text-secondary)";
  const c = KIND_COLOR[node.kind];
  const panelHeight = expanded ? "60vh" : 180;

  return (
    <div style={{ flexShrink: 0, borderTop: "1px solid var(--c-border)", background: "var(--c-bg-raised)", display: "flex", flexDirection: "column", height: panelHeight, transition: "height .2s" }}>
      {/* Header */}
      <div style={{ padding: `${SPACE.sm}px ${SPACE.lg}px`, display: "flex", alignItems: "center", gap: SPACE.sm, borderBottom: `1px solid ${C.border.muted}`, flexShrink: 0 }}>
        <span style={{ fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.bold, color: c.text, background: c.bg, border: `1px solid ${c.border}`, borderRadius: RADIUS.sm, padding: `${SPACE.xxs}px ${SPACE.sm}px`, textTransform: "uppercase" }}>
          {node.kind}
        </span>
        <strong style={{ fontSize: FONT_SIZE.md }}>{node.name}</strong>
        {node.namespace && <span style={{ fontSize: FONT_SIZE.sm, color: C.text.muted }}>/ {node.namespace}</span>}
        <span style={{ fontSize: FONT_SIZE.sm, color: C.text.muted }}>Status: <span style={{ color: statusColor }}>{node.status}</span></span>

        {/* Tabs */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          {(["info", "describe", "logs"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: `3px ${SPACE.sm}px`, fontSize: FONT_SIZE.sm, background: tab === t ? "var(--c-bg-active)" : "transparent",
              border: `1px solid ${tab === t ? "var(--c-accent)" : C.border.strong}`,
              color: tab === t ? "var(--c-accent-hover)" : C.text.muted,
              borderRadius: RADIUS.sm, cursor: "pointer", fontWeight: tab === t ? FONT_WEIGHT.semibold : FONT_WEIGHT.normal,
            }}>{t === "describe" ? "Details" : t === "info" ? "Info" : "Logs"}</button>
          ))}
        </div>
        <button onClick={() => setExpanded(e => !e)} title={expanded ? "Minimize" : "Maximize"}
          style={{ background: "none", border: "none", color: C.text.muted, cursor: "pointer", padding: `${SPACE.xxs}px ${SPACE.xs}px`, display: "flex", alignItems: "center" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {expanded ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}
          </svg>
        </button>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.text.muted, cursor: "pointer", display: "flex", alignItems: "center", padding: `${SPACE.xxs}px ${SPACE.xs}px` }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: `${SPACE.sm}px ${SPACE.lg}px` }}>
        {tab === "info" && (
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: `${SPACE.xs}px ${SPACE.md}px`, fontSize: FONT_SIZE.sm }}>
            <span style={{ color: C.text.muted }}>Kind</span><span>{node.kind}</span>
            <span style={{ color: C.text.muted }}>Name</span><span>{node.name}</span>
            <span style={{ color: C.text.muted }}>Namespace</span><span>{node.namespace || "—"}</span>
            <span style={{ color: C.text.muted }}>Status</span><span style={{ color: statusColor }}>{node.status}</span>
          </div>
        )}
        {tab === "describe" && (
          loading ? <span style={{ color: C.text.muted, fontSize: FONT_SIZE.sm }}>Loading…</span>
            : <pre style={{ fontFamily: "'Cascadia Code','Consolas',monospace", fontSize: FONT_SIZE.sm, color: C.text.muted, whiteSpace: "pre-wrap", lineHeight: 1.5, margin: 0 }}>{detail.describe ?? "—"}</pre>
        )}
        {tab === "logs" && (
          loading ? <span style={{ color: C.text.muted, fontSize: FONT_SIZE.sm }}>Loading…</span>
            : node.kind === "pod"
              ? <pre style={{ fontFamily: "'Cascadia Code','Consolas',monospace", fontSize: FONT_SIZE.sm, color: C.text.muted, whiteSpace: "pre-wrap", lineHeight: 1.5, margin: 0 }}>{detail.logs ?? "No logs (only available for pods)"}</pre>
              : <div style={{ color: C.text.muted, fontSize: FONT_SIZE.sm, paddingTop: SPACE.sm }}>Logs are only available for pod resources.</div>
        )}
      </div>
    </div>
  );
}
