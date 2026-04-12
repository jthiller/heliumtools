import defaultTheme from "tailwindcss/defaultTheme";
import forms from "@tailwindcss/forms";

/** Wrap a CSS custom property so Tailwind can inject <alpha-value>. */
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./oui-notifier/index.html",
    "./oui-notifier/verify/index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: "media",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Inter var", ...defaultTheme.fontFamily.sans],
        display: ["Space Grotesk", ...defaultTheme.fontFamily.sans],
        mono: ["JetBrains Mono", ...defaultTheme.fontFamily.mono],
      },
      colors: {
        surface: {
          DEFAULT: rgb("--color-surface"),
          raised: rgb("--color-surface-raised"),
          inset: rgb("--color-surface-inset"),
        },
        border: {
          DEFAULT: rgb("--color-border"),
          muted: rgb("--color-border-muted"),
        },
        content: {
          DEFAULT: rgb("--color-content"),
          secondary: rgb("--color-content-secondary"),
          tertiary: rgb("--color-content-tertiary"),
        },
        accent: {
          DEFAULT: rgb("--color-accent"),
          text: rgb("--color-accent-text"),
          surface: "var(--color-accent-surface)",
        },
        iot: rgb("--color-iot"),
        mobile: rgb("--color-mobile"),
      },
      boxShadow: {
        soft: "0 10px 30px rgba(15, 23, 42, 0.08)",
      },
      backgroundImage: {
        "grid-slate":
          "radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.2) 1px, transparent 0)",
      },
      keyframes: {
        "pulse-once": {
          "0%": { backgroundColor: "rgb(var(--color-accent) / 0.12)" },
          "100%": { backgroundColor: "transparent" },
        },
        flipOut: {
          "0%": { transform: "translateY(0)", opacity: "1" },
          "100%": { transform: "translateY(-100%)", opacity: "0" },
        },
        flipIn: {
          "0%": { transform: "translateY(100%)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "pulse-once": "pulse-once 1.5s ease-out forwards",
      },
    },
  },
  plugins: [forms],
};
