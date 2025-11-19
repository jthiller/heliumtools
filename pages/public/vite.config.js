import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

const htmlInjectionPlugin = () => {
  return {
    name: "html-injection",
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: "link",
            attrs: {
              rel: "preconnect",
              href: "https://fonts.googleapis.com",
            },
            injectTo: "head",
          },
          {
            tag: "link",
            attrs: {
              rel: "preconnect",
              href: "https://fonts.gstatic.com",
              crossorigin: true,
            },
            injectTo: "head",
          },
          {
            tag: "link",
            attrs: {
              href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
              rel: "stylesheet",
            },
            injectTo: "head",
          },
        ],
      };
    },
  };
};

export default defineConfig({
  plugins: [react(), htmlInjectionPlugin()],
  base: "/",
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(root, "index.html"),
        oui: path.resolve(root, "oui-notifier/index.html"),
        verify: path.resolve(root, "oui-notifier/verify/index.html"),
      },
    },
  },
});
