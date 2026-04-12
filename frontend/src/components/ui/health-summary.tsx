import { useEffect, useState, useCallback } from "react";
import { api } from "../../api/client";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT } from "../../utils/theme";
import type { HealthSummary } from "../../types";

interface Props {
  targetId: string;
  /** Auto-refresh interval in ms. Pass null to disable. Default: 30000 */
  refreshMs?: number | null;
}

/** Compact workload health bar — auto-fetches and refreshes. */
export function HealthSummaryBar({ targetId, refreshMs = 30_000 }: Props) {
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [error, setError] = useState(false);

  const fetch = useCallback(async () => {
    try {
      const data = await api.health(targetId);
      setHealth(data);
      setError(false);
    } catch {
      setError(true);
    }
  }, [targetId]);

  useEffect(() => {
    fetch();
    if (refreshMs == null || refreshMs <= 0) return;
    const id = setInterval(fetch, refreshMs);
    return () => clearInterval(id);
  }, [fetch, refreshMs]);

  if (error) return null; // silently hide on error
  if (!health) return <HealthSkeleton />;

  const groups: { label: string; items: StatusItem[] }[] = [];

  // Kubernetes
  if (health.pods) {
    const p = health.pods;
    const items: StatusItem[] = [
      { count: p.running,   label: "running",   color: C.status.success },
      { count: p.pending,   label: "pending",   color: C.status.warning },
      { count: p.failed,    label: "failed",    color: C.status.danger  },
    ];
    if (p.succeeded > 0) items.push({ count: p.succeeded, label: "succeeded", color: C.text.muted });
    groups.push({ label: "Pods", items });
  }
  if (health.deployments) {
    const d = health.deployments;
    groups.push({
      label: "Deploys",
      items: [{ count: d.ready, label: `/ ${d.total} ready`, color: d.ready === d.total ? C.status.success : C.status.warning }],
    });
  }
  if (health.nodes) {
    const n = health.nodes;
    groups.push({
      label: "Nodes",
      items: [{ count: n.ready, label: `/ ${n.total} ready`, color: n.ready === n.total ? C.status.success : C.status.warning }],
    });
  }

  // Docker
  if (health.containers) {
    const c = health.containers;
    groups.push({
      label: "Containers",
      items: [
        { count: c.running, label: "running", color: C.status.success },
        { count: c.stopped, label: "stopped", color: C.status.danger  },
      ],
    });
  }

  // SSH / Local
  if (health.services) {
    const s = health.services;
    groups.push({
      label: "Services",
      items: [
        { count: s.active, label: "active", color: C.status.success },
        { count: s.failed, label: "failed", color: C.status.danger  },
      ],
    });
  }

  if (groups.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: SPACE.lg,
        padding: `${SPACE.sm}px ${SPACE.md}px`,
        background: "var(--c-bg-raised)",
        border: "1px solid var(--c-border)",
        borderRadius: RADIUS.lg,
      }}
      role="region"
      aria-label="Workload health"
    >
      {groups.map(g => (
        <div key={g.label} style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>
          <span style={{ fontSize: FONT_SIZE.xs, fontWeight: FONT_WEIGHT.bold, color: C.text.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>
            {g.label}
          </span>
          {g.items.filter(i => i.count > 0).map((item, idx) => (
            <span key={idx} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: item.color, display: "inline-block", flexShrink: 0 }} />
              <span style={{ fontSize: FONT_SIZE.sm, fontWeight: FONT_WEIGHT.medium, color: C.text.secondary }}>
                {item.count} {item.label}
              </span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

interface StatusItem {
  count: number;
  label: string;
  color: string;
}

function HealthSkeleton() {
  return (
    <div
      style={{
        height: 32,
        borderRadius: RADIUS.lg,
        background: "var(--c-bg-raised)",
        border: "1px solid var(--c-border)",
        animation: "pulse 1.5s infinite",
      }}
      role="status"
      aria-label="Loading health data"
    />
  );
}
