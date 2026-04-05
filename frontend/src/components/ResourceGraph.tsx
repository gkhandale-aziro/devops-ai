/**
 * ResourceGraph.tsx — Visual K8s resource topology graph.
 * Shows Deployment → Pods → Services → Ingresses as connected nodes.
 * Pure CSS/SVG — no external graph library needed.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import type { Target } from "../types";
import { api } from "../api/client";

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

const KIND_COLOR: Record<string, { bg: string; border: string; text: string }> = {
  deployment: { bg: "#1a1040", border: "#6366f1", text: "#818cf8" },
  pod:        { bg: "#0a1a14", border: "#22c55e", text: "#4ade80" },
  service:    { bg: "#1a1100", border: "#f59e0b", text: "#fbbf24" },
  ingress:    { bg: "#0c1a2a", border: "#06b6d4", text: "#22d3ee" },
};

const POD_STATUS_COLOR: Record<string, string> = {
  Running:           "#22c55e",
  Completed:         "#06b6d4",
  Pending:           "#f59e0b",
  CrashLoopBackOff:  "#ef4444",
  Error:             "#ef4444",
  OOMKilled:         "#ef4444",
  ImagePullBackOff:  "#f97316",
};

const NODE_W = 160;
const NODE_H = 48;
const COL_GAP = 60;
const ROW_GAP = 14;

export function ResourceGraph({ target, namespace }: Props) {
  const [nodes,   setNodes]   = useState<Node[]>([]);
  const [edges,   setEdges]   = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<Node | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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
          // Connect ingresses to services by host/name match only
          data.ingresses.forEach(ing => {
            const hosts = ing.hosts ?? "";
            if (hosts.includes(svc.name) || svc.name.includes(ing.name.split("-")[0])) {
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
  }, [target.id, namespace]);

  if (loading) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "#64748b", fontSize: 13 }}>
      <span style={{ width: 14, height: 14, border: "2px solid #1e2235", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin .7s linear infinite", display: "inline-block" }} />
      Building topology…
    </div>
  );

  if (error) return (
    <div style={{ padding: 20, color: "#f43f5e", fontSize: 13 }}>kubectl not available or no resources found.</div>
  );

  if (nodes.length === 0) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 13 }}>
      No resources found in {namespace || "any namespace"}.
    </div>
  );

  const maxX = Math.max(...nodes.map(n => n.x + n.width)) + 60;
  const maxY = Math.max(...nodes.map(n => n.y + n.height)) + 60;

  const getCenter = (n: Node) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Legend */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #1e2235", display: "flex", gap: 16, alignItems: "center", flexShrink: 0, background: "#0b0d14" }}>
        <span style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700 }}>Topology</span>
        {(["ingress", "service", "deployment", "pod"] as const).map(kind => {
          const c = KIND_COLOR[kind];
          return (
            <div key={kind} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c.border, display: "inline-block" }} />
              <span style={{ fontSize: 11, color: "#64748b", textTransform: "capitalize" }}>{kind}</span>
            </div>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#475569" }}>{nodes.length} resources</span>
      </div>

      {/* SVG Graph */}
      <div style={{ flex: 1, overflow: "auto", padding: 12, background: "#0b0d14" }}>
        <svg ref={svgRef} width={maxX} height={maxY} style={{ display: "block" }}>
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#2d3555" />
            </marker>
          </defs>

          {/* Edges */}
          {edges.map((e, i) => {
            const from = nodes.find(n => n.id === e.from);
            const to   = nodes.find(n => n.id === e.to);
            if (!from || !to) return null;
            const f = getCenter(from);
            const t = getCenter(to);
            const mx = (f.x + t.x) / 2;
            const isHov = hovered === from.id || hovered === to.id;
            return (
              <path
                key={i}
                d={`M${f.x + from.width / 2 - 10},${f.y} C${mx},${f.y} ${mx},${t.y} ${t.x - to.width / 2 + 10},${t.y}`}
                fill="none"
                stroke={isHov ? "#6366f1" : "#1e2235"}
                strokeWidth={isHov ? 1.5 : 1}
                markerEnd="url(#arrow)"
                style={{ transition: "stroke .15s" }}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map(n => {
            const c     = KIND_COLOR[n.kind];
            const isHov = hovered === n.id;
            const isSel = selected?.id === n.id;
            const statusColor = n.kind === "pod" ? (POD_STATUS_COLOR[n.status] ?? "#64748b") : c.border;
            const shortName = n.name.length > 18 ? n.name.slice(0, 17) + "…" : n.name;

            return (
              <g
                key={n.id}
                onClick={() => setSelected(isSel ? null : n)}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}
              >
                {/* Shadow */}
                {(isHov || isSel) && (
                  <rect x={n.x - 2} y={n.y - 2} width={n.width + 4} height={n.height + 4} rx={9}
                    fill="none" stroke={c.border} strokeWidth={2} opacity={0.4} />
                )}
                {/* Card */}
                <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={7}
                  fill={c.bg} stroke={isSel ? c.border : isHov ? c.border + "88" : "#1e2235"} strokeWidth={isSel ? 2 : 1} />
                {/* Left accent bar */}
                <rect x={n.x} y={n.y + 8} width={3} height={n.height - 16} rx={2} fill={c.border} />
                {/* Status dot */}
                <circle cx={n.x + n.width - 12} cy={n.y + n.height / 2} r={4} fill={statusColor} />
                {/* Kind label */}
                <text x={n.x + 14} y={n.y + 16} fontSize={9} fill={c.text} fontWeight={700} style={{ textTransform: "uppercase", letterSpacing: ".5px" }}>
                  {n.kind}
                </text>
                {/* Name */}
                <text x={n.x + 14} y={n.y + 32} fontSize={11} fill="#cbd5e1" fontWeight={500}>
                  {shortName}
                </text>
              </g>
            );
          })}
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

  const statusColor = POD_STATUS_COLOR[node.status] ?? "#94a3b8";
  const c = KIND_COLOR[node.kind];
  const panelHeight = expanded ? "60vh" : 180;

  return (
    <div style={{ flexShrink: 0, borderTop: "1px solid #1e2235", background: "#0f1219", display: "flex", flexDirection: "column", height: panelHeight, transition: "height .2s" }}>
      {/* Header */}
      <div style={{ padding: "8px 16px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #1e2235", flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: c.text, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 4, padding: "2px 8px", textTransform: "uppercase" }}>
          {node.kind}
        </span>
        <strong style={{ fontSize: 13 }}>{node.name}</strong>
        {node.namespace && <span style={{ fontSize: 11, color: "#64748b" }}>/ {node.namespace}</span>}
        <span style={{ fontSize: 11, color: "#64748b" }}>Status: <span style={{ color: statusColor }}>{node.status}</span></span>

        {/* Tabs */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          {(["info", "describe", "logs"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "3px 10px", fontSize: 11, background: tab === t ? "#1e2240" : "transparent",
              border: `1px solid ${tab === t ? "#6366f1" : "#2d3148"}`,
              color: tab === t ? "#818cf8" : "#64748b",
              borderRadius: 4, cursor: "pointer", fontWeight: tab === t ? 600 : 400,
              textTransform: "capitalize",
            }}>{t}</button>
          ))}
        </div>
        <button onClick={() => setExpanded(e => !e)} title={expanded ? "Minimize" : "Maximize"}
          style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14, padding: "2px 4px" }}>
          {expanded ? "▾" : "▴"}
        </button>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
        {tab === "info" && (
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "4px 12px", fontSize: 12 }}>
            <span style={{ color: "#64748b" }}>Kind</span><span>{node.kind}</span>
            <span style={{ color: "#64748b" }}>Name</span><span>{node.name}</span>
            <span style={{ color: "#64748b" }}>Namespace</span><span>{node.namespace || "—"}</span>
            <span style={{ color: "#64748b" }}>Status</span><span style={{ color: statusColor }}>{node.status}</span>
          </div>
        )}
        {tab === "describe" && (
          loading ? <span style={{ color: "#64748b", fontSize: 12 }}>Loading…</span>
            : <pre style={{ fontFamily: "'Cascadia Code','Consolas',monospace", fontSize: 11, color: "#8b949e", whiteSpace: "pre-wrap", lineHeight: 1.5, margin: 0 }}>{detail.describe ?? "—"}</pre>
        )}
        {tab === "logs" && (
          loading ? <span style={{ color: "#64748b", fontSize: 12 }}>Loading…</span>
            : node.kind === "pod"
              ? <pre style={{ fontFamily: "'Cascadia Code','Consolas',monospace", fontSize: 11, color: "#8b949e", whiteSpace: "pre-wrap", lineHeight: 1.5, margin: 0 }}>{detail.logs ?? "No logs (only available for pods)"}</pre>
              : <div style={{ color: "#64748b", fontSize: 12, paddingTop: 8 }}>Logs are only available for pod resources.</div>
        )}
      </div>
    </div>
  );
}
