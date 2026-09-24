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
  server: { fs: { allow: [path.resolve(__dirname, "..")] } },
});
