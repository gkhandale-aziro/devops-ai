import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import { ProtectedRoute } from "./ProtectedRoute";

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
});

afterEach(() => { vi.restoreAllMocks(); });

function Tree(initialPath = "/secret") {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div data-testid="login-page">login</div>} />
          <Route
            path="/secret"
            element={
              <ProtectedRoute>
                <div data-testid="secret-page">secret</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("ProtectedRoute", () => {
  it("redirects anonymous users to /login", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "nope" }, false, 401));

    render(Tree("/secret"));

    await waitFor(() => {
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("secret-page")).not.toBeInTheDocument();
  });

  it("renders children for authenticated users", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      id: 1, username: "alice", role: "admin",
    }));

    render(Tree("/secret"));

    await waitFor(() => {
      expect(screen.getByTestId("secret-page")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("login-page")).not.toBeInTheDocument();
  });

  it("shows a loading placeholder before /me resolves", async () => {
    // Never-resolving promise → component stays in loading state.
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    render(Tree("/secret"));

    expect(screen.getByTestId("auth-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("secret-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("login-page")).not.toBeInTheDocument();
  });
});
