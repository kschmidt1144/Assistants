import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: { "/api": { target: "http://localhost:8003", changeOrigin: true } },
  },
  optimizeDeps: { exclude: ["@assistants/core-web"] },
});
