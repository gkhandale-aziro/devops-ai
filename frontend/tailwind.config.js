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
      },
    },
  },
  plugins: [],
};
