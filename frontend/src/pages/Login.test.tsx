import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext";
import { Login } from "./Login";

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

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => { vi.restoreAllMocks(); });

function renderLogin(initialPath = "/login") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div data-testid="home">home</div>} />
          <Route path="/secret" element={<div data-testid="secret">secret</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("Login page", () => {
  it("renders username + password fields", async () => {
    // Initial /auth/me returns 401 (anonymous)
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "nope" }, false, 401));
    renderLogin();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("submits credentials and navigates to / on success", async () => {
    const user = userEvent.setup();
    // /auth/me 401, then /auth/login 200
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "nope" }, false, 401))
      .mockResolvedValueOnce(jsonResponse({
        user: { id: 1, username: "alice", role: "admin" },
      }));

    renderLogin();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/username/i), "alice");
    await user.type(screen.getByLabelText(/password/i), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByTestId("home")).toBeInTheDocument();
    });

    // login call was made with JSON payload + credentials: "include"
    const loginCall = mockFetch.mock.calls.find(
      ([url]) => url === "/api/v1/auth/login"
    );
    expect(loginCall).toBeDefined();
    expect(loginCall?.[1]?.credentials).toBe("include");
    expect(JSON.parse(loginCall?.[1]?.body as string)).toEqual({
      username: "alice", password: "correct-horse-battery",
    });
  });

  it("redirects to / when already authenticated", async () => {
    // /auth/me resolves as logged-in → Login should immediately <Navigate> home.
    mockFetch.mockResolvedValueOnce(jsonResponse({
      id: 1, username: "alice", role: "admin",
    }));

    renderLogin();

    await waitFor(() => {
      expect(screen.getByTestId("home")).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("shows an inline error on bad credentials", async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "nope" }, false, 401))
      .mockResolvedValueOnce(jsonResponse({ error: "invalid credentials" }, false, 401));

    renderLogin();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/username/i), "alice");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/invalid credentials/i);
    });
  });
});
