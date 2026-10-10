import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Heebo", "system-ui", "sans-serif"] },
      colors: {
        ink: { 900: "#0f172a", 700: "#334155", 500: "#64748b", 400: "#94a3b8", 300: "#cbd5e1", 200: "#e2e8f0", 100: "#f1f5f9", 50: "#f8fafc" },
        brand: { 700: "#1d4ed8", 600: "#2563eb", 500: "#3b82f6", 100: "#dbeafe", 50: "#eff6ff" },
      },
      boxShadow: {
        pop: "0 10px 30px -10px rgba(15,23,42,.25), 0 2px 6px rgba(15,23,42,.08)",
      },
    },
  },
  plugins: [],
} satisfies Config;
