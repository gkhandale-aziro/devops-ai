import type {
  Target, TargetType, StoredEvent, Stats, ChatSession, TriageLevel,
} from "../types";

const BASE = "";  // same origin — Vite proxy handles /api in dev

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  if (!res.ok) {
    let detail = "";
    try { const b = await res.json(); detail = b?.error ?? b?.message ?? ""; } catch { /* ignore */ }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ── Targets ───────────────────────────────────────────────────────────────────

export const api = {
  targets: {
    list: ()                         => req<Target[]>("/api/targets"),
    add:  (name: string, type: TargetType, config: Record<string, string>) =>
      req<Target>("/api/targets", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name, type, config }),
      }),
    remove: (id: string) =>
      req<{ ok: boolean }>(`/api/targets/${id}`, { method: "DELETE" }),
    test: (id: string) =>
      req<{ status: string; message: string }>(`/api/targets/${id}/test`),
  },

  // ── Server info ───────────────────────────────────────────────────────────

  info: () => req<{ tool_model: string; answer_model: string }>("/api/info"),

  // ── Tab data ───────────────────────────────────────────────────────────────

  tab: (targetId: string, tab: string, params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params) : "";
    return req<Record<string, string>>(`/api/tab/${targetId}/${tab}${qs}`);
  },

  // ── Resource detail ────────────────────────────────────────────────────────

  resource: (targetId: string, kind: string, name: string, ns: string) =>
    req<Record<string, string>>(
      `/api/resource/${targetId}?${new URLSearchParams({ kind, name, ns })}`
    ),

  // ── Chat (target-scoped) ───────────────────────────────────────────────────

  /** Returns a ReadableStream of SSE data — caller reads chunks */
  chatStream: (targetId: string, message: string, signal?: AbortSignal) =>
    fetch(`/api/chat/${targetId}/stream`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message }),
      signal,
    }),

  // ── AI analysis ───────────────────────────────────────────────────────────

  analyzeStream: (prompt: string) =>
    fetch("/api/analyze/stream", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ prompt }),
    }),

  // ── General chat sessions ──────────────────────────────────────────────────

  sessions: {
    list:   () => req<ChatSession[]>("/api/sessions"),
    create: (title: string) =>
      req<ChatSession>("/api/sessions", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ title }),
      }),
    remove:  (id: string) =>
      req<{ ok: boolean }>(`/api/sessions/${id}`, { method: "DELETE" }),
    messages: (id: string) =>
      req<Array<{ role: string; content: string }>>(`/api/sessions/${id}/messages`),
    chatStream: (id: string, message: string, signal?: AbortSignal) =>
      fetch(`/api/sessions/${id}/chat/stream`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message }),
        signal,
      }),
  },

  // ── Monitor ───────────────────────────────────────────────────────────────

  monitor: {
    start:  (targetId: string) =>
      req<{ ok: boolean; monitoring: string }>(`/api/monitor/start/${targetId}`, { method: "POST" }),
    stop:   () => req<{ ok: boolean }>("/api/monitor/stop", { method: "POST" }),
    status: () => req<{ active: boolean }>("/api/monitor/status"),
  },

  // ── Event history (DB) ────────────────────────────────────────────────────

  events: {
    list: (params?: { level?: TriageLevel; object?: string; limit?: number }) =>
      req<StoredEvent[]>(`/api/events?${new URLSearchParams(
        Object.fromEntries(
          Object.entries(params ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
        )
      )}`),
    get: (id: number) =>
      req<StoredEvent>(`/api/events/${id}`),
    byObject: (name: string, limit = 20) =>
      req<StoredEvent[]>(`/api/events/object/${encodeURIComponent(name)}?limit=${limit}`),
    updateStatus: (id: number, status: string) =>
      req<{ ok: boolean }>(`/api/events/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status }),
      }),
  },

  stats: () => req<Stats>("/api/stats"),

  // ── Topology ──────────────────────────────────────────────────────────────
  topology: (targetId: string, namespace?: string) => {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : "";
    return req<{
      deployments: Array<{ namespace: string; name: string; ready: string; available: string }>;
      pods:        Array<{ namespace: string; name: string; ready: string; status: string; restarts: string }>;
      services:    Array<{ namespace: string; name: string; type: string; port: string }>;
      ingresses:   Array<{ namespace: string; name: string; hosts: string }>;
    }>(`/api/topology/${targetId}${qs}`);
  },

  // ── Search ────────────────────────────────────────────────────────────────
  search: (targetId: string, q: string) =>
    req<{ results: Array<{ kind: string; namespace: string; name: string; status: string }> }>(
      `/api/search/${targetId}?q=${encodeURIComponent(q)}`
    ),

  // ── Log stream ────────────────────────────────────────────────────────────
  logStreamUrl: (targetId: string, pod: string, namespace: string, container?: string) => {
    const params = new URLSearchParams({ pod, namespace });
    if (container) params.set("container", container);
    return `/api/logs/${targetId}/stream?${params}`;
  },
};

// ── SSE stream reader helper ───────────────────────────────────────────────────

export async function* readSSE(
  res: Response
): AsyncGenerator<Record<string, unknown>> {
  if (!res.body) return;
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") return;
      try { yield JSON.parse(raw); } catch { /* skip malformed */ }
    }
  }
}
