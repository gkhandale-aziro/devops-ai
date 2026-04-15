import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext";

// ── Mock fetch ───────────────────────────────────────────────────────────────

let mockFetch: ReturnType<typeof vi.fn>;

function jsonResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Unauthorized",
    json: async () => data,
    body: null,
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  (window as unknown as Record<string, unknown>).__AZIRO_API_KEY__ = undefined;
  localStorage.removeItem("aziro_api_key");
});

afterEach(() => { vi.restoreAllMocks(); });

// A tiny consumer that renders whatever AuthContext exposes so we can
// assert on it without pulling in React Router.
function Probe() {
  const { user, loading, isAuthenticated, canWrite, logout } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="auth">{String(isAuthenticated)}</div>
      <div data-testid="canWrite">{String(canWrite)}</div>
      <div data-testid="user">{user ? `${user.username}:${user.role}` : "none"}</div>
      <button onClick={() => void logout()}>logout</button>
    </div>
  );
}

describe("AuthContext", () => {
  it("bootstraps an authenticated user when /me returns 200", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      id: 1, username: "alice", role: "admin",
    }));

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("auth").textContent).toBe("true");
    expect(screen.getByTestId("canWrite").textContent).toBe("true");
    expect(screen.getByTestId("user").textContent).toBe("alice:admin");
  });

  it("stays anonymous when /me returns 401", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "not authenticated" }, false, 401));

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("auth").textContent).toBe("false");
    expect(screen.getByTestId("canWrite").textContent).toBe("false");
    expect(screen.getByTestId("user").textContent).toBe("none");
  });

  it("viewer role has canWrite=false", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      id: 2, username: "bob", role: "viewer",
    }));

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("canWrite").textContent).toBe("false");
    expect(screen.getByTestId("user").textContent).toBe("bob:viewer");
  });

  it("clears user on `aziro:unauthorized` event", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      id: 1, username: "alice", role: "admin",
    }));

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(screen.getByTestId("auth").textContent).toBe("true");
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("aziro:unauthorized"));
    });

    expect(screen.getByTestId("auth").textContent).toBe("false");
    expect(screen.getByTestId("user").textContent).toBe("none");
  });
});
