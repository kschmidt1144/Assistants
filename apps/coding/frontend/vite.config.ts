import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Browser talks one origin: Vite proxies /api + /ws to the local FastAPI backend (port 8001).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8001", changeOrigin: true },
      "/ws": { target: "ws://localhost:8001", ws: true },
    },
  },
  // Consume the workspace lib as source (don't pre-bundle TS/TSX).
  optimizeDeps: { exclude: ["@assistants/core-web"] },
});
