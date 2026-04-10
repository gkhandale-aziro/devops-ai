import { C } from "../../utils/theme";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
}

/**
 * Shared empty-state placeholder — centered icon + title + optional description.
 * Used across pages/tabs when data is absent or an API returns nothing.
 */
export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: 12, padding: 40,
      color: C.text.muted,
    }}>
      <div style={{ opacity: 0.5 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text.secondary }}>{title}</div>
      {description && (
        <div style={{ fontSize: 12, color: C.text.faint, textAlign: "center", maxWidth: 320, lineHeight: 1.6 }}>
          {description}
        </div>
      )}
    </div>
  );
}
