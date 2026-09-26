import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { midenVitePlugin } from "@miden-sdk/vite-plugin";

// On Safari and WKWebView (Bread's in-app browser) the SDK runs its classic worker, which fetches
// "assets/miden_client_web.wasm" relative to its own /assets/ URL, a path Vite never emits (the page
// got a 404 there, which Safari reports as a wasm MIME type error). Emit the wasm right there instead;
// Vercel serves every asset with must-revalidate, so the missing hash costs nothing.
const assetFileNames = (a: { names?: string[] }) => ((a.names?.[0] ?? "").endsWith(".wasm") ? "assets/assets/miden_client_web.wasm" : "assets/[name]-[hash][extname]");

export default defineConfig({
  plugins: [react(), midenVitePlugin({ crossOriginIsolation: true })],
  // page and worker builds both emit the wasm at the one path the classic worker can find
  build: { rollupOptions: { output: { assetFileNames } } },
  worker: { rollupOptions: { output: { assetFileNames } } },
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  // the stake note script lives with the contracts and is imported as raw text
  // fixed port: the SDK's IndexedDB store is per origin, so sharing localhost:5173 with another Miden app mixes state
  server: { port: 5180, strictPort: true, fs: { allow: [path.resolve(__dirname, "..")] } },
});
