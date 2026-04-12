/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Plus Jakarta Sans'", "'Segoe UI'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "'Cascadia Code'", "'Consolas'", "monospace"],
      },
      colors: {
        brand: {
          DEFAULT: "#6366f1",
          light: "#818cf8",
          dim: "#6366f122",
        },
        background: "var(--c-bg-base)",
        surface: "var(--c-bg-surface)",
        raised: "var(--c-bg-raised)",
        overlay: "var(--c-bg-overlay)",
        foreground: "var(--c-text-primary)",
        "muted-foreground": "var(--c-text-muted)",
        "secondary-foreground": "var(--c-text-secondary)",
        border: "var(--c-border)",
        "border-strong": "var(--c-border-strong)",
        accent: {
          DEFAULT: "var(--c-accent)",
          dim: "var(--c-accent-dim)",
          hover: "var(--c-accent-hover)",
        },
        destructive: "var(--c-red)",
        success: "var(--c-green)",
        warning: "var(--c-yellow)",
      },
      borderColor: {
        DEFAULT: "var(--c-border)",
      },
    },
  },
  plugins: [],
};
