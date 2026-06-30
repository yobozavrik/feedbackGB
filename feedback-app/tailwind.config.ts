import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        elev: "rgb(var(--elev) / <alpha-value>)",
        elev2: "rgb(var(--elev-2) / <alpha-value>)",
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
        },
        amber: {
          400: "rgb(var(--accent-amber) / <alpha-value>)",
        },
        ink: {
          900: "rgb(var(--ink-900) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
          300: "rgb(var(--ink-300) / <alpha-value>)",
        },
        cat: {
          missing: "rgb(var(--cat-missing) / <alpha-value>)",
          overstock: "rgb(var(--cat-overstock) / <alpha-value>)",
          defect: "rgb(var(--cat-defect) / <alpha-value>)",
          supply: "rgb(var(--cat-supply) / <alpha-value>)",
          idea: "rgb(var(--cat-idea) / <alpha-value>)",
          spotted: "rgb(var(--cat-spotted) / <alpha-value>)",
          tech: "rgb(var(--cat-tech) / <alpha-value>)",
          voice: "rgb(var(--cat-voice) / <alpha-value>)",
        },
        success: "rgb(var(--success) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(20,27,43,0.05), 0 10px 28px rgba(20,27,43,0.08)",
        ring: "0 0 0 4px rgb(var(--brand-500) / 0.18)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      animation: {
        "fade-up": "fadeUp 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)",
        "slide-up": "slideUp 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)",
        pop: "pop 0.4s cubic-bezier(0.2, 1.6, 0.4, 1)",
        shake: "shake 0.22s ease-in-out",
        shimmer: "shimmer 1.4s linear infinite",
        "pulse-soft": "pulseSoft 1.4s ease-in-out infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideUp: {
          "0%": { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
        },
        pop: {
          "0%": { transform: "scale(0.5)", opacity: "0" },
          "60%": { transform: "scale(1.1)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-4px)" },
          "50%": { transform: "translateX(4px)" },
          "80%": { transform: "translateX(-2px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.4", transform: "scale(0.9)" },
          "50%": { opacity: "1", transform: "scale(1.1)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
