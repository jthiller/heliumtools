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
        // Wallet Dashboard tokens (wallet-dashboard/wallet-dashboard.css,
        // defined only while the dashboard is loaded): `text-wd-ink-2`,
        // `bg-wd-caution-surface`, `border-wd-line-2`, `bg-wd-oui-1`…
        wd: {
          canvas: rgb("--wd-canvas"),
          well: rgb("--wd-well"),
          line: { DEFAULT: rgb("--wd-line"), 2: rgb("--wd-line-2") },
          control: rgb("--wd-control"),
          ink: { DEFAULT: rgb("--wd-ink"), 2: rgb("--wd-ink-2"), 3: rgb("--wd-ink-3"), 4: rgb("--wd-ink-4") },
          "accent-line": "var(--wd-accent-line)",
          hnt: rgb("--wd-hnt"),
          sol: rgb("--wd-sol"),
          dc: rgb("--wd-dc"),
          iot: { DEFAULT: rgb("--wd-iot"), text: rgb("--wd-iot-text"), soft: "var(--wd-iot-soft)" },
          mobile: { DEFAULT: rgb("--wd-mobile"), text: rgb("--wd-mobile-text"), soft: "var(--wd-mobile-soft)" },
          caution: { DEFAULT: rgb("--wd-caution"), text: rgb("--wd-caution-text"), surface: "var(--wd-caution-surface)" },
          critical: { DEFAULT: rgb("--wd-critical"), text: rgb("--wd-critical-text"), surface: "var(--wd-critical-surface)" },
          oui: {
            1: rgb("--wd-oui-1"),
            2: rgb("--wd-oui-2"),
            3: rgb("--wd-oui-3"),
            4: rgb("--wd-oui-4"),
            5: rgb("--wd-oui-5"),
            other: rgb("--wd-oui-other"),
          },
        },
      },
      // Wallet Dashboard type scale (the design's tokens.css). `-sm` variants
      // are the phone sizes of the same roles.
      fontSize: {
        "wd-xl": ["52px", { lineHeight: "56px", letterSpacing: "-0.04em" }],
        "wd-xl-sm": ["30px", { lineHeight: "36px", letterSpacing: "-0.03em" }],
        "wd-l": ["32px", { lineHeight: "38px", letterSpacing: "-0.02em" }],
        "wd-m": ["24px", { lineHeight: "30px", letterSpacing: "-0.02em" }],
        "wd-s": ["18px", { lineHeight: "24px" }],
        "wd-h1": ["26px", { lineHeight: "32px", letterSpacing: "-0.02em" }],
        "wd-h1-sm": ["22px", { lineHeight: "28px", letterSpacing: "-0.02em" }],
        "wd-h2": ["22px", { lineHeight: "28px", letterSpacing: "-0.02em" }],
        "wd-h2-sm": ["20px", { lineHeight: "26px", letterSpacing: "-0.02em" }],
        "wd-title": ["15px", { lineHeight: "22px", letterSpacing: "-0.01em" }],
        "wd-sm": ["13px", { lineHeight: "18px" }],
        "wd-cap": ["12px", { lineHeight: "16px" }],
        "wd-eyebrow": ["11px", { lineHeight: "16px", letterSpacing: "0.14em" }],
      },
      boxShadow: {
        soft: "var(--shadow-card)",
        "soft-lg": "var(--shadow-card-lg)",
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
        "bar-grow": {
          "0%": { transform: "scaleY(0)" },
          "100%": { transform: "scaleY(1)" },
        },
      },
      animation: {
        "pulse-once": "pulse-once 1.5s ease-out forwards",
        // Tailwind's `ping` keyframes, played once (a live dot's arrival cue).
        "ping-once": "ping 1s cubic-bezier(0, 0, 0.2, 1) 1 forwards",
        "bar-grow": "bar-grow 0.6s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [forms],
};
