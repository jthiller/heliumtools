import defaultTheme from "tailwindcss/defaultTheme";
import forms from "@tailwindcss/forms";

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
          DEFAULT: "var(--color-surface)",
          raised: "var(--color-surface-raised)",
          inset: "var(--color-surface-inset)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          muted: "var(--color-border-muted)",
        },
        content: {
          DEFAULT: "var(--color-content)",
          secondary: "var(--color-content-secondary)",
          tertiary: "var(--color-content-tertiary)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          text: "var(--color-accent-text)",
          surface: "var(--color-accent-surface)",
        },
        iot: "var(--color-iot)",
        mobile: "var(--color-mobile)",
      },
      boxShadow: {
        soft: "0 10px 30px rgba(15, 23, 42, 0.08)",
      },
      backgroundImage: {
        "grid-slate":
          "radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.2) 1px, transparent 0)",
      },
    },
  },
  plugins: [forms],
};
