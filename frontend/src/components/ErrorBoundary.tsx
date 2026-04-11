import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.warn("[ErrorBoundary] caught:", error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 16,
          padding: 32, textAlign: "center",
          background: "var(--c-bg-base)", color: "var(--c-text-primary)",
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: "var(--c-sev1-bg)", border: "1px solid var(--c-sev1)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <AlertTriangle size={24} stroke="var(--c-sev1)" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
              This page crashed
            </div>
            <div style={{ fontSize: 13, color: "var(--c-text-muted)", maxWidth: 420, lineHeight: 1.6 }}>
              {this.state.error?.message ?? "An unexpected error interrupted this view."}
              <div style={{ marginTop: 8 }}>Reload to recover — your connections and settings are safe.</div>
            </div>
          </div>
          <button
            onClick={() => window.location.reload()}
            aria-label="Reload page"
            style={{
              background: "var(--c-accent)", color: "#fff",
              border: "none", borderRadius: 8,
              padding: "10px 24px", fontSize: 13, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
