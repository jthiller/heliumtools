import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react(), nodePolyfills()],
  base: "/",
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET || "http://localhost:8787",
        changeOrigin: true,
        // Forward WebSocket upgrades too — the multi-gateway tool's
        // /api/multi-gateway/events endpoint is now a WebSocket fan-out
        // backed by the MultiGatewayHub Durable Object.
        ws: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/oui-notifier/api": {
        target: process.env.VITE_API_TARGET || "http://localhost:8787",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/oui-notifier\/api/, "/oui-notifier"),
      },
    },
  },
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
