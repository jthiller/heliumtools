import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
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
