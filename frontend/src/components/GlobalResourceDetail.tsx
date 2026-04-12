/**
 * GlobalResourceDetail — mounts a single ResourceModal driven by the
 * resourceDetailStore. Any component (Cmd+K palette, tables, AI drawer)
 * can call `openResourceDetail(...)` and this component fetches the
 * describe/logs data and shows the existing modal. Per-table modals
 * continue to work independently; this is additive.
 */
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ResourceModal } from "../pages/dashboard/tables";
import {
  useResourceDetail,
  closeResourceDetail,
  type ResourceDetailRequest,
} from "../stores/resourceDetailStore";

type ModalData = {
  kind: string;
  name: string;
  ns:   string;
  data: Record<string, string>;
};

export function GlobalResourceDetail() {
  const req = useResourceDetail();
  const [resource, setResource] = useState<ModalData | null>(null);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    if (!req) { setResource(null); return; }
    let cancelled = false;
    setLoading(true);
    setResource(null);
    (async () => {
      try {
        const data = await api.resource(req.targetId, req.kind, req.name, req.ns);
        if (cancelled) return;
        setResource({ kind: req.kind, name: req.name, ns: req.ns, data });
      } catch (e) {
        if (cancelled) return;
        setResource({
          kind: req.kind, name: req.name, ns: req.ns,
          data: { describe: `Failed to load: ${(e as Error).message}` },
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [req?.targetId, req?.kind, req?.name, req?.ns]);

  if (!req) return null;

  return (
    <ResourceModal
      resource={resource}
      loading={loading}
      targetId={req.targetId}
      onClose={closeResourceDetail}
      initialTab={(req.tab === "logs" || req.tab === "ai") ? req.tab : "describe"}
    />
  );
}

// Re-export for callers that need the type without importing the store.
export type { ResourceDetailRequest };
