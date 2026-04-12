/**
 * resourceDetailStore — module-level singleton that lets any component
 * (Command Palette, tables, AI chat) request a ResourceModal to open for
 * a specific kind/name/namespace. Built on useSyncExternalStore so it
 * stays in sync with React concurrent rendering.
 *
 * Usage:
 *   const req = useResourceDetail();              // subscribes to current request
 *   openResourceDetail(tid, "pod", name, ns);     // fire from anywhere
 *   closeResourceDetail();                        // dismiss
 */
import { useSyncExternalStore } from "react";

export interface ResourceDetailRequest {
  targetId: string;
  kind:     string;
  name:     string;
  ns:       string;
  /** Which tab to open on mount. Defaults to "describe". */
  tab?: "describe" | "logs" | "ai";
}

let current: ResourceDetailRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function openResourceDetail(
  targetId: string,
  kind: string,
  name: string,
  ns: string,
  tab: ResourceDetailRequest["tab"] = "describe",
): void {
  current = { targetId, kind, name, ns, tab };
  emit();
}

export function closeResourceDetail(): void {
  current = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): ResourceDetailRequest | null {
  return current;
}

export function useResourceDetail(): ResourceDetailRequest | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
