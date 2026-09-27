import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tauri expects a fixed dev port and no clever host tricks.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    target: "chrome110",
    emptyOutDir: true,
  },
});
