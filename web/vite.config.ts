import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { midenVitePlugin } from "@miden-sdk/vite-plugin";

export default defineConfig({
  plugins: [react(), midenVitePlugin({ crossOriginIsolation: true })],
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  // the stake note script lives with the contracts and is imported as raw text
  // fixed port: the SDK's IndexedDB store is per origin, so sharing localhost:5173 with another Miden app mixes state
  server: { port: 5180, strictPort: true, fs: { allow: [path.resolve(__dirname, "..")] } },
});
