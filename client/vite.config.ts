import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const isTest = process.env.VITEST === "true" || process.env.NODE_ENV === "test";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: isTest ? {} : {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
// Vite cache flush config edit
