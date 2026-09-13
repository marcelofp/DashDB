import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8088",
        changeOrigin: true,
      },
    },
  },
  test: { include: ["src/**/*.test.ts"] },
  build: { chunkSizeWarningLimit: 1100 },
});
