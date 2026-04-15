/**
 * ProtectedRoute — gates the main app shell. Until /auth/me resolves we
 * show a minimal loading state so we don't flash the login page for a
 * logged-in user. After resolve: redirect to /login if anonymous.
 */
import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        data-testid="auth-loading"
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--c-bg-base)",
          color: "var(--c-text-muted)",
          fontSize: 13,
        }}
      >
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    // Pass the attempted path so Login can send the user back after auth.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
