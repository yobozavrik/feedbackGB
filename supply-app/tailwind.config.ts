import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: {
    colors: {
      bg: "rgb(var(--bg) / <alpha-value>)", elev: "rgb(var(--elev) / <alpha-value>)",
      brand: { 50: "rgb(var(--brand-50) / <alpha-value>)", 500: "rgb(var(--brand-500) / <alpha-value>)", 600: "rgb(var(--brand-600) / <alpha-value>)" },
      ink: { 900: "rgb(var(--ink-900) / <alpha-value>)", 500: "rgb(var(--ink-500) / <alpha-value>)", 300: "rgb(var(--ink-300) / <alpha-value>)" },
    },
    boxShadow: { soft: "0 1px 2px rgba(20,27,43,.05),0 10px 28px rgba(20,27,43,.08)" },
    animation: { shake: "shake .22s ease-in-out", "pulse-soft": "pulseSoft 1.4s ease-in-out infinite" },
    keyframes: { shake: { "0%,100%": { transform: "translateX(0)" }, "20%": { transform: "translateX(-4px)" }, "50%": { transform: "translateX(4px)" }, "80%": { transform: "translateX(-2px)" } }, pulseSoft: { "0%,100%": { opacity: ".4" }, "50%": { opacity: "1" } } },
  } },
  plugins: [],
} satisfies Config;
