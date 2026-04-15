/**
 * AuthContext — holds the current user + exposes login/logout.
 *
 * Mount-time flow:
 *   1. Call GET /api/v1/auth/me.
 *   2. 200 → we have a session; stash the user.
 *   3. 401 → anonymous; AuthProvider stays in "unauthenticated" state and
 *      ProtectedRoute will bounce to /login.
 *
 * Runtime:
 *   - Any request that 401s fires a window "aziro:unauthorized" event
 *     (emitted from api/client.ts). We clear the stored user so
 *     ProtectedRoute redirects on the next render. Login + /me itself
 *     are excluded from the hook in client.ts to avoid a loop.
 */
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { api } from "../api/client";

export type Role = "admin" | "viewer";

export interface AuthUser {
  id:       number;
  username: string;
  role:     Role;
}

interface AuthState {
  user:            AuthUser | null;
  loading:         boolean;
  isAuthenticated: boolean;
  canWrite:        boolean;
  login:           (username: string, password: string) => Promise<void>;
  logout:          () => Promise<void>;
  refresh:         () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const me = await api.auth.me();
      setUser({ id: me.id, username: me.username, role: me.role });
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onUnauth = () => setUser(null);
    window.addEventListener("aziro:unauthorized", onUnauth);
    return () => window.removeEventListener("aziro:unauthorized", onUnauth);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { user: u } = await api.auth.login(username, password);
    setUser({ id: u.id, username: u.username, role: u.role });
  }, []);

  const logout = useCallback(async () => {
    try { await api.auth.logout(); } finally { setUser(null); }
  }, []);

  const value: AuthState = {
    user,
    loading,
    isAuthenticated: user !== null,
    canWrite:        user?.role === "admin",
    login,
    logout,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
