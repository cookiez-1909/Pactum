import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative paths, so the static build works from any location.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173 },
});
