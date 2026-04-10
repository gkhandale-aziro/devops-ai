/**
 * ThemeContext.tsx — Day / Night two-theme system.
 * Follows prefers-color-scheme by default. User override persists in localStorage.
 * Applies data-theme="day"|"night" on <html> so CSS custom properties switch.
 */
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { Sun, Moon } from "lucide-react";

export type ThemeName = "day" | "night";

interface ThemeCtx {
  theme:    ThemeName;
  setTheme: (t: ThemeName) => void;
}

const ThemeContext = createContext<ThemeCtx>({ theme: "night", setTheme: () => {} });

export function useTheme() { return useContext(ThemeContext); }

const STORAGE_KEY = "aziro-theme";

function systemPreference(): ThemeName {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "day" : "night";
  } catch {
    return "night";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "day" || stored === "night") return stored;
    } catch { /* SSR safe */ }
    return systemPreference();
  });

  const setTheme = (t: ThemeName) => {
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDay = theme === "day";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{
        fontSize: 9, color: "var(--c-text-faint)", textTransform: "uppercase",
        letterSpacing: ".6px", fontWeight: 600,
      }}>
        {isDay ? "Day" : "Night"}
      </span>
      <button
        onClick={() => setTheme(isDay ? "night" : "day")}
        aria-label={isDay ? "Switch to night mode" : "Switch to day mode"}
        title={isDay ? "Switch to night mode" : "Switch to day mode"}
        style={{
          width: 32, height: 32, borderRadius: 8,
          background: "var(--c-bg-raised)",
          border: "1px solid var(--c-border)",
          cursor: "pointer", display: "flex",
          alignItems: "center", justifyContent: "center",
          color: "var(--c-text-secondary)",
          transition: "all .15s",
        }}
      >
        {isDay ? <Moon size={14} /> : <Sun size={14} />}
      </button>
    </div>
  );
}
