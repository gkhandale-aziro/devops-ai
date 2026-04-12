import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { api, readSSE } from "./client";

// ── Mock fetch ───────────────────────────────────────────────────────────────

let mockFetch: ReturnType<typeof vi.fn>;

function jsonResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => data,
    body: null,
  } as unknown as Response;
}

function rawResponse(body?: ReadableStream<Uint8Array> | null) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: body ?? null,
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  // Clear any API key so authHeaders() returns {}
  (window as unknown as Record<string, unknown>).__AZIRO_API_KEY__ = undefined;
  localStorage.removeItem("aziro_api_key");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Targets ──────────────────────────────────────────────────────────────────

describe("api.targets", () => {
  it("list() — GET /api/v1/targets", async () => {
    const data = [{ id: "t1", name: "cluster-1" }];
    mockFetch.mockResolvedValueOnce(jsonResponse(data));

    const result = await api.targets.list();

    expect(result).toEqual(data);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/targets");
    expect(init.method).toBeUndefined();
  });

  it("add() — POST /api/v1/targets with correct body", async () => {
    const created = { id: "t2", name: "new-cluster" };
    mockFetch.mockResolvedValueOnce(jsonResponse(created));

    const result = await api.targets.add("new-cluster", "kubernetes", { kubeconfig: "..." });

    expect(result).toEqual(created);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/targets");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      name: "new-cluster",
      type: "kubernetes",
      config: { kubeconfig: "..." },
    });
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("remove() — DELETE /api/v1/targets/{id}", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await api.targets.remove("t1");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/targets/t1");
    expect(init.method).toBe("DELETE");
  });

  it("update() — PATCH /api/v1/targets/{id}", async () => {
    const updated = { id: "t1", name: "renamed" };
    mockFetch.mockResolvedValueOnce(jsonResponse(updated));

    const result = await api.targets.update("t1", "renamed", { kubeconfig: "new" });

    expect(result).toEqual(updated);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/targets/t1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ name: "renamed", config: { kubeconfig: "new" } });
  });

  it("test() — GET /api/v1/targets/{id}/test", async () => {
    const data = { status: "ok", message: "reachable" };
    mockFetch.mockResolvedValueOnce(jsonResponse(data));

    const result = await api.targets.test("t1");

    expect(result).toEqual(data);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/targets/t1/test");
  });
});

// ── Server info ──────────────────────────────────────────────────────────────

describe("api.info / api.modelHealth", () => {
  it("info() — GET /api/v1/info", async () => {
    const data = { tool_model: "gpt-4", answer_model: "gpt-3.5" };
    mockFetch.mockResolvedValueOnce(jsonResponse(data));

    const result = await api.info();

    expect(result).toEqual(data);
    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/info");
  });

  it("modelHealth() — GET /api/v1/models/health", async () => {
    const data = { status: "healthy", primary_tool: "gpt-4" };
    mockFetch.mockResolvedValueOnce(jsonResponse(data));

    const result = await api.modelHealth();

    expect(result).toEqual(data);
    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/models/health");
  });
});

// ── Tab data ─────────────────────────────────────────────────────────────────

describe("api.tab", () => {
  it("builds correct URL with targetId and tab", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ pods: [] }));

    await api.tab("t1", "pods");

    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/tab/t1/pods");
  });

  it("appends query params when provided", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await api.tab("t1", "pods", { namespace: "default" });

    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/tab/t1/pods?namespace=default");
  });
});

// ── Resource detail ──────────────────────────────────────────────────────────

describe("api.resource", () => {
  it("builds correct URL with query params", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ kind: "Pod" }));

    await api.resource("t1", "Pod", "nginx", "default");

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/v1/resource/t1?");
    expect(url).toContain("kind=Pod");
    expect(url).toContain("name=nginx");
    expect(url).toContain("ns=default");
  });
});

// ── Models ───────────────────────────────────────────────────────────────────

describe("api.models", () => {
  it("list() — GET /api/v1/models", async () => {
    const data = { ollama: ["llama3"], cloud: [], current: {}, ollama_url: "" };
    mockFetch.mockResolvedValueOnce(jsonResponse(data));

    const result = await api.models.list();

    expect(result).toEqual(data);
    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/models");
  });

  it("update() — PUT /api/v1/models with body", async () => {
    const body = { tool_model: "llama3" };
    mockFetch.mockResolvedValueOnce(jsonResponse({ tool_model: "llama3", answer_model: "llama3" }));

    await api.models.update(body);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/models");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual(body);
  });
});

// ── Monitor ──────────────────────────────────────────────────────────────────

describe("api.monitor", () => {
  it("start() — POST /api/v1/monitor/{targetId}", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, monitoring: "t1" }));

    await api.monitor.start("t1");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/monitor/t1");
    expect(init.method).toBe("POST");
  });

  it("stop() — DELETE /api/v1/monitor", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await api.monitor.stop();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/monitor");
    expect(init.method).toBe("DELETE");
  });

  it("status() — GET /api/v1/monitor/status", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ active: true }));

    const result = await api.monitor.status();

    expect(result).toEqual({ active: true });
    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/monitor/status");
  });
});

// ── Stats ────────────────────────────────────────────────────────────────────

describe("api.stats", () => {
  it("GET /api/v1/stats", async () => {
    const data = { targets: 2, events: 10 };
    mockFetch.mockResolvedValueOnce(jsonResponse(data));

    const result = await api.stats();

    expect(result).toEqual(data);
    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/stats");
  });
});

// ── Events ───────────────────────────────────────────────────────────────────

describe("api.events", () => {
  it("list() — GET /api/v1/events with optional params", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    await api.events.list({ level: "SEV1", limit: 5 });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/v1/events?");
    expect(url).toContain("level=SEV1");
    expect(url).toContain("limit=5");
  });

  it("list() — works with no params", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    await api.events.list();

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/v1/events");
  });

  it("get() — GET /api/v1/events/{id}", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1 }));

    await api.events.get(1);

    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/events/1");
  });

  it("updateStatus() — PATCH /api/v1/events/{id}", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await api.events.updateStatus(1, "acknowledged");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/events/1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ status: "acknowledged" });
  });
});

// ── Streaming endpoints ──────────────────────────────────────────────────────

describe("api.chatStream", () => {
  it("POST /api/v1/chat/{targetId}/stream — returns raw Response", async () => {
    const fakeRes = rawResponse();
    mockFetch.mockResolvedValueOnce(fakeRes);

    const result = await api.chatStream("t1", "hello");

    expect(result).toBe(fakeRes);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/chat/t1/stream");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ message: "hello" });
  });
});

describe("api.analyzeStream", () => {
  it("POST /api/v1/analyze/stream — returns raw Response", async () => {
    const fakeRes = rawResponse();
    mockFetch.mockResolvedValueOnce(fakeRes);

    const result = await api.analyzeStream("check pods");

    expect(result).toBe(fakeRes);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/analyze/stream");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ prompt: "check pods" });
  });
});

// ── Error handling ───────────────────────────────────────────────────────────

describe("error handling", () => {
  it("throws on non-ok response with error detail from JSON body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Not found" }, false, 404));

    await expect(api.targets.list()).rejects.toThrow("Not found");
  });

  it("throws with status code when body has no error field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    });

    await expect(api.targets.list()).rejects.toThrow("500 Internal Server Error");
  });

  it("throws on network failure (fetch throws TypeError)", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(api.targets.list()).rejects.toThrow("Network error");
  });
});

// ── Auth headers ─────────────────────────────────────────────────────────────

describe("auth headers", () => {
  it("sends Authorization header when API key is set via window global", async () => {
    (window as unknown as Record<string, unknown>).__AZIRO_API_KEY__ = "test-key-123";
    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    await api.targets.list();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer test-key-123");
  });

  it("sends Authorization header from localStorage fallback", async () => {
    (window as unknown as Record<string, unknown>).__AZIRO_API_KEY__ = undefined;
    localStorage.setItem("aziro_api_key", "ls-key");
    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    await api.targets.list();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer ls-key");
  });
});

// ── readSSE ──────────────────────────────────────────────────────────────────

describe("readSSE", () => {
  function makeSSEStream(lines: string[]): Response {
    const encoder = new TextEncoder();
    const chunks = [encoder.encode(lines.join("\n") + "\n")];
    let index = 0;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(chunks[index++]);
        } else {
          controller.close();
        }
      },
    });

    return { body: stream } as unknown as Response;
  }

  it("parses SSE data lines into objects", async () => {
    const res = makeSSEStream([
      'data: {"token":"hello"}',
      'data: {"token":" world"}',
    ]);

    const items: Record<string, unknown>[] = [];
    for await (const item of readSSE(res)) {
      items.push(item);
    }

    expect(items).toEqual([{ token: "hello" }, { token: " world" }]);
  });

  it("stops on [DONE] sentinel", async () => {
    const res = makeSSEStream([
      'data: {"token":"a"}',
      "data: [DONE]",
      'data: {"token":"b"}',
    ]);

    const items: Record<string, unknown>[] = [];
    for await (const item of readSSE(res)) {
      items.push(item);
    }

    expect(items).toEqual([{ token: "a" }]);
  });

  it("skips non-data lines", async () => {
    const res = makeSSEStream([
      ": comment",
      "event: ping",
      'data: {"ok":true}',
    ]);

    const items: Record<string, unknown>[] = [];
    for await (const item of readSSE(res)) {
      items.push(item);
    }

    expect(items).toEqual([{ ok: true }]);
  });

  it("skips malformed JSON data lines", async () => {
    const res = makeSSEStream([
      "data: {bad json",
      'data: {"good":true}',
    ]);

    const items: Record<string, unknown>[] = [];
    for await (const item of readSSE(res)) {
      items.push(item);
    }

    expect(items).toEqual([{ good: true }]);
  });

  it("returns nothing when response body is null", async () => {
    const res = { body: null } as unknown as Response;

    const items: Record<string, unknown>[] = [];
    for await (const item of readSSE(res)) {
      items.push(item);
    }

    expect(items).toEqual([]);
  });
});
