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
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Inter var", ...defaultTheme.fontFamily.sans],
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
