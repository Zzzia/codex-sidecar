import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(rootDir, "src/shared"),
      "@web": path.resolve(rootDir, "src/web"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 4316,
    proxy: {
      "/api": "http://127.0.0.1:4315",
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4316,
  },
  build: {
    outDir: "dist",
  },
});
