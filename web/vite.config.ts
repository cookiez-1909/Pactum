import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative paths, so the static build works from any location.
export default defineConfig({
  base: "./",
  plugins: [react()],
  // The landing page reads the testnet run's addresses from the deployments folder at the repo root.
  server: { port: 5173, fs: { allow: [".."] } },
});
