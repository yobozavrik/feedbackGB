import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "#FFF8F3",
        blush: {
          50: "#FFF5F7",
          100: "#FFE4EC",
          200: "#FFC9D9",
          300: "#FFA8C0",
          400: "#FF85A8",
          500: "#F76391",
          600: "#E04679",
        },
        peach: {
          100: "#FFE8D6",
          200: "#FFD0AE",
          300: "#FFB585",
        },
        lavender: {
          100: "#EFE7FF",
          200: "#D9C9FF",
          300: "#BFA8FF",
          400: "#A287FF",
        },
        mint: {
          100: "#DDF5EC",
          200: "#A9E5CC",
          300: "#74D2AC",
        },
        ink: {
          900: "#2A1A2E",
          700: "#5A4A60",
          500: "#8A7B90",
          300: "#C4BAC9",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 8px 24px -8px rgba(247, 99, 145, 0.18)",
        card: "0 4px 16px -4px rgba(42, 26, 46, 0.08)",
        glow: "0 0 0 4px rgba(255, 169, 192, 0.25)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      animation: {
        "fade-up": "fadeUp 0.35s ease-out",
        "pop": "pop 0.25s ease-out",
        "shimmer": "shimmer 2.5s linear infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pop: {
          "0%": { transform: "scale(0.96)" },
          "60%": { transform: "scale(1.02)" },
          "100%": { transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
