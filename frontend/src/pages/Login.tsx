/**
 * Login page — username/password form that posts to /api/v1/auth/login.
 * On success, we bounce to `state.from` (the path the user originally
 * asked for) or "/" as a default.
 */
import { useState, useEffect } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { LogIn, AlertCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { C, SPACE, RADIUS, FONT_SIZE, FONT_WEIGHT, SHADOW } from "../utils/theme";

export function Login() {
  const { login, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);

  useEffect(() => { document.title = "Sign in — Aziro"; }, []);

  if (isAuthenticated) return <Navigate to={from} replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error)?.message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: `${SPACE.sm}px ${SPACE.md}px`,
    fontSize: FONT_SIZE.sm,
    background: "var(--c-bg-surface)",
    color: "var(--c-text-primary)",
    border: `1px solid ${C.border.muted}`,
    borderRadius: RADIUS.sm,
    outline: "none",
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--c-bg-base)",
        color: "var(--c-text-primary)",
        padding: SPACE.lg,
      }}
    >
      <form
        onSubmit={onSubmit}
        aria-busy={busy || loading}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "var(--c-bg-raised)",
          border: `1px solid ${C.border.subtle}`,
          borderRadius: RADIUS.md,
          padding: SPACE.xl,
          boxShadow: SHADOW.md,
          display: "flex",
          flexDirection: "column",
          gap: SPACE.md,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>
          <LogIn size={18} color={C.accent.primary} />
          <h1 style={{
            margin: 0,
            fontSize: FONT_SIZE.lg,
            fontWeight: FONT_WEIGHT.semibold,
          }}>
            Sign in to Aziro
          </h1>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: FONT_SIZE.xs, color: "var(--c-text-muted)" }}>
            Username
          </span>
          <input
            type="text"
            autoComplete="username"
            autoFocus
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: FONT_SIZE.xs, color: "var(--c-text-muted)" }}>
            Password
          </span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </label>

        {error && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: C.status.danger,
              fontSize: FONT_SIZE.xs,
              background: C.error.bg,
              border: `1px solid ${C.error.border}`,
              borderRadius: RADIUS.sm,
              padding: `${SPACE.xs}px ${SPACE.sm}px`,
            }}
          >
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !username || !password}
          style={{
            padding: `${SPACE.sm}px ${SPACE.md}px`,
            background: C.accent.primary,
            color: "#fff",
            border: "none",
            borderRadius: RADIUS.sm,
            fontSize: FONT_SIZE.sm,
            fontWeight: FONT_WEIGHT.medium,
            cursor: busy ? "wait" : "pointer",
            opacity: (busy || !username || !password) ? 0.6 : 1,
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
