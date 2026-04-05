/**
 * ThemeContext.tsx — P5: Color theme switcher.
 * Themes: Default (Indigo), Tron (Cyan/Green), Sapphire (Blue).
 * Applies CSS custom properties on :root so all existing code Just Works™.
 */
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type ThemeName = "default" | "tron" | "sapphire";

interface ThemeCtx {
  theme:    ThemeName;
  setTheme: (t: ThemeName) => void;
}

const ThemeContext = createContext<ThemeCtx>({ theme: "default", setTheme: () => {} });

export function useTheme() { return useContext(ThemeContext); }

const THEMES: Record<ThemeName, Record<string, string>> = {
  default: {
    "--c-accent":        "#6366f1",
    "--c-accent-dim":    "#6366f122",
    "--c-accent-hover":  "#818cf8",
    "--c-bg-base":       "#0b0d14",
    "--c-bg-surface":    "#0f1219",
    "--c-bg-raised":     "#161b27",
    "--c-bg-overlay":    "#1e2235",
    "--c-border":        "#1e2235",
    "--c-border-strong": "#2d3555",
    "--c-text-primary":  "#e2e8f0",
    "--c-text-secondary":"#94a3b8",
    "--c-text-muted":    "#64748b",
    "--c-text-faint":    "#475569",
  },
  tron: {
    "--c-accent":        "#06b6d4",
    "--c-accent-dim":    "#06b6d422",
    "--c-accent-hover":  "#22d3ee",
    "--c-bg-base":       "#050a0e",
    "--c-bg-surface":    "#0a1118",
    "--c-bg-raised":     "#0f1a24",
    "--c-bg-overlay":    "#162230",
    "--c-border":        "#0e2a3a",
    "--c-border-strong": "#164050",
    "--c-text-primary":  "#d4f0f8",
    "--c-text-secondary":"#7ec8d8",
    "--c-text-muted":    "#4a8898",
    "--c-text-faint":    "#2a5868",
  },
  sapphire: {
    "--c-accent":        "#3b82f6",
    "--c-accent-dim":    "#3b82f622",
    "--c-accent-hover":  "#60a5fa",
    "--c-bg-base":       "#080c16",
    "--c-bg-surface":    "#0c1222",
    "--c-bg-raised":     "#121d34",
    "--c-bg-overlay":    "#1a2744",
    "--c-border":        "#1a2744",
    "--c-border-strong": "#2a3d64",
    "--c-text-primary":  "#dbe7f8",
    "--c-text-secondary":"#8bacd4",
    "--c-text-muted":    "#5580a8",
    "--c-text-faint":    "#3a5a7a",
  },
};

export const THEME_META: Record<ThemeName, { label: string; preview: string }> = {
  default:  { label: "Indigo",   preview: "#6366f1" },
  tron:     { label: "Tron",     preview: "#06b6d4" },
  sapphire: { label: "Sapphire", preview: "#3b82f6" },
};

const STORAGE_KEY = "aziro-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && stored in THEMES) return stored as ThemeName;
    } catch { /* SSR safe */ }
    return "default";
  });

  const setTheme = (t: ThemeName) => {
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
  };

  // Apply CSS variables on <html>
  useEffect(() => {
    const vars = THEMES[theme];
    const root = document.documentElement;
    for (const [key, val] of Object.entries(vars)) {
      root.style.setProperty(key, val);
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * ThemeSwitcher — small widget for the sidebar footer.
 */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ fontSize: 9, color: "var(--c-text-faint)", textTransform: "uppercase", letterSpacing: ".6px" }}>
        Theme
      </span>
      {(Object.entries(THEME_META) as [ThemeName, { label: string; preview: string }][]).map(([key, meta]) => (
        <button
          key={key}
          onClick={() => setTheme(key)}
          title={meta.label}
          style={{
            width: 16, height: 16, borderRadius: 4,
            background: meta.preview,
            border: theme === key ? "2px solid #fff" : "2px solid transparent",
            cursor: "pointer",
            opacity: theme === key ? 1 : 0.5,
            transition: "all .15s",
          }}
        />
      ))}
    </div>
  );
}
