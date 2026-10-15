import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react(), nodePolyfills()],
  base: "/",
  resolve: {
    alias: [
      // The Wallet Dashboard's Mobile engine reads ZSTD Parquet and Avro only:
      // swap the full decompressor set (Brotli dictionary, Snappy WASM) for a
      // slim module. A regex so only the bare specifier is rewritten; a string
      // alias would also rewrite `hyparquet-compressors/src/gzip.js`, which the
      // slim module imports.
      {
        find: /^hyparquet-compressors$/,
        replacement: path.resolve(root, "src/wallet-dashboard/mobile/slimCompressors.js"),
      },
    ],
  },
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
    // Landing tool-card prints stay real files even when tiny: inlined, both
    // themes would ride in the JS bundle instead of the <picture> fetching one.
    assetsInlineLimit: (filePath) => (filePath.includes("/src/assets/previews/") ? false : undefined),
    rollupOptions: {
      input: {
        main: path.resolve(root, "index.html"),
        oui: path.resolve(root, "oui-notifier/index.html"),
        verify: path.resolve(root, "oui-notifier/verify/index.html"),
      },
    },
  },
});
