import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": { target: "http://127.0.0.1:8000", ws: true, changeOrigin: true },
    },
  },
  build: { target: "es2022", sourcemap: true },
});
