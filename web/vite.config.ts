import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the API runs on its own port. Proxying /api keeps the
    // browser on one origin, so cookies and CORS behave as they will in production.
    proxy: {
      "/api": "http://localhost:4000",
      "/docs": "http://localhost:4000",
    },
  },
});
