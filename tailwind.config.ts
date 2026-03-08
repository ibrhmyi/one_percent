import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: "var(--surface)",
        line: "var(--line)",
        accent: "var(--accent)",
        muted: "var(--muted)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)"
      },
      fontFamily: {
        sans: ["Avenir Next", "IBM Plex Sans", "Segoe UI", "sans-serif"],
        display: ["Avenir Next Condensed", "IBM Plex Sans", "sans-serif"]
      },
      boxShadow: {
        panel: "0 12px 40px rgba(3, 8, 20, 0.45)"
      },
      backgroundImage: {
        "panel-glow":
          "radial-gradient(circle at top, rgba(61, 180, 242, 0.12), transparent 48%), radial-gradient(circle at bottom right, rgba(94, 234, 212, 0.08), transparent 35%)"
      }
    }
  },
  plugins: []
};

export default config;
