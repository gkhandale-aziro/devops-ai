import type {
  Target, TargetType, StoredEvent, Stats, ChatSession, TriageLevel,
  TopologyResponse, SearchResponse,
} from "../types";

const BASE = "";  // same origin — Vite proxy handles /api in dev

/**
 * Auth header helper — reads AZIRO_API_KEY injected by the backend into
 * index.html as window.__AZIRO_API_KEY__, or falls back to localStorage
 * so users can paste a key via the browser console.
 */
function authHeaders(): Record<string, string> {
  const key =
    (window as unknown as Record<string, string>).__AZIRO_API_KEY__ ??
    localStorage.getItem("aziro_api_key") ??
    "";
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = { ...authHeaders(), ...init?.headers };
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers });
  } catch (e) {
    // fetch() throws TypeError on network failure (server down, DNS, offline,
    // CORS). Surface a clearer message than the default "Failed to fetch".
    throw new Error(`Network error — could not reach server (${(e as Error)?.message || "offline"})`);
  }
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
    list: ()                         => req<Target[]>("/api/v1/targets"),
    add:  (name: string, type: TargetType, config: Record<string, string>) =>
      req<Target>("/api/v1/targets", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name, type, config }),
      }),
    remove: (id: string) =>
      req<{ ok: boolean }>(`/api/v1/targets/${id}`, { method: "DELETE" }),
    test: (id: string) =>
      req<{ status: string; message: string }>(`/api/v1/targets/${id}/test`),
  },

  // ── Cloud auth check ──────────────────────────────────────────────────────

  cloud: {
    check: (provider: string, config?: Record<string, string>) =>
      req<{ cli_installed: boolean; authenticated: boolean; identity: string; error: string }>(
        `/api/v1/cloud/check/${provider}`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(config ?? {}),
        },
      ),
  },

  // ── Server info ───────────────────────────────────────────────────────────

  info: () => req<{ tool_model: string; answer_model: string }>("/api/v1/info"),

  // ── Tab data ───────────────────────────────────────────────────────────────

  tab: (targetId: string, tab: string, params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params) : "";
    return req<Record<string, string>>(`/api/v1/tab/${targetId}/${tab}${qs}`);
  },

  // ── Namespace list ─────────────────────────────────────────────────────────

  namespaces: (targetId: string) =>
    req<string[]>(`/api/v1/namespaces/${targetId}`),

  // ── Resource detail ────────────────────────────────────────────────────────

  resource: (targetId: string, kind: string, name: string, ns: string) =>
    req<Record<string, string>>(
      `/api/v1/resource/${targetId}?${new URLSearchParams({ kind, name, ns })}`
    ),

  // ── Chat (target-scoped) ───────────────────────────────────────────────────

  /** Returns a ReadableStream of SSE data — caller reads chunks */
  chatStream: (targetId: string, message: string, signal?: AbortSignal) =>
    fetch(`/api/v1/chat/${targetId}/stream`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body:    JSON.stringify({ message }),
      signal,
    }),

  // ── AI analysis ───────────────────────────────────────────────────────────

  analyzeStream: (prompt: string) =>
    fetch("/api/v1/analyze/stream", {
      method:  "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body:    JSON.stringify({ prompt }),
    }),

  // ── General chat sessions ──────────────────────────────────────────────────

  sessions: {
    list:   () => req<ChatSession[]>("/api/v1/sessions"),
    create: (title: string) =>
      req<ChatSession>("/api/v1/sessions", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ title }),
      }),
    remove:  (id: string) =>
      req<{ ok: boolean }>(`/api/v1/sessions/${id}`, { method: "DELETE" }),
    messages: (id: string) =>
      req<Array<{ role: string; content: string }>>(`/api/v1/sessions/${id}/messages`),
    chatStream: (id: string, message: string, signal?: AbortSignal) =>
      fetch(`/api/v1/sessions/${id}/chat/stream`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body:    JSON.stringify({ message }),
        signal,
      }),
  },

  // ── Metrics ──────────────────────────────────────────────────────────────
  metrics: (targetId: string, params?: { metric?: string; range?: string }) => {
    const qs = params ? "?" + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined))
    ) : "";
    return req<Record<string, { t: string; v: number }[]>>(`/api/v1/metrics/${targetId}${qs}`);
  },

  // ── Monitor ───────────────────────────────────────────────────────────────

  monitor: {
    start:  (targetId: string) =>
      req<{ ok: boolean; monitoring: string }>(`/api/v1/monitor/${targetId}`, { method: "POST" }),
    stop:   () => req<{ ok: boolean }>("/api/v1/monitor", { method: "DELETE" }),
    status: () => req<{ active: boolean }>("/api/v1/monitor/status"),
  },

  // ── Event history (DB) ────────────────────────────────────────────────────

  events: {
    list: (params?: { level?: TriageLevel; object?: string; limit?: number }) =>
      req<StoredEvent[]>(`/api/v1/events?${new URLSearchParams(
        Object.fromEntries(
          Object.entries(params ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
        )
      )}`),
    get: (id: number) =>
      req<StoredEvent>(`/api/v1/events/${id}`),
    byObject: (name: string, limit = 20) =>
      req<StoredEvent[]>(`/api/v1/events/object/${encodeURIComponent(name)}?limit=${limit}`),
    updateStatus: (id: number, status: string) =>
      req<{ ok: boolean }>(`/api/v1/events/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status }),
      }),
  },

  stats: () => req<Stats>("/api/v1/stats"),

  // ── Topology ──────────────────────────────────────────────────────────────
  topology: (targetId: string, namespace?: string) => {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : "";
    return req<TopologyResponse>(`/api/v1/topology/${targetId}${qs}`);
  },

  // ── Models ────────────────────────────────────────────────────────────────
  models: {
    list: () =>
      req<{ ollama: string[]; current: { tool_model: string; answer_model: string } }>("/api/v1/models"),
    update: (body: { tool_model?: string; answer_model?: string }) =>
      req<{ tool_model: string; answer_model: string }>("/api/v1/models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
  },

  // ── Search ────────────────────────────────────────────────────────────────
  search: (targetId: string, q: string) =>
    req<SearchResponse>(`/api/v1/search/${targetId}?q=${encodeURIComponent(q)}`),

  // ── Log stream ────────────────────────────────────────────────────────────
  logStreamUrl: (targetId: string, pod: string, namespace: string, container?: string) => {
    const params = new URLSearchParams({ pod, namespace });
    if (container) params.set("container", container);
    return `/api/v1/logs/${targetId}/stream?${params}`;
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

  // try/finally guarantees we release the reader lock if the consumer
  // breaks early or throws — otherwise the underlying connection stays
  // pinned until GC, which can leak fetch sockets across aborts.
  try {
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
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
}
