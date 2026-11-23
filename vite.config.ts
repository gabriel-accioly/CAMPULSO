import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  publicDir: mode === "technical" ? false : "public",
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4177,
    strictPort: true,
  },
  build: {
    outDir: mode === "technical" ? "dist-technical" : "dist",
    rollupOptions: { input: mode === "technical" ? "diagnostic.html" : "index.html" },
    target: "es2022",
    sourcemap: false,
  },
}));
