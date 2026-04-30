import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  base: "./",
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    outDir: resolve(__dirname, "out/tauri-renderer"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "src/renderer/src"),
    },
  },
  plugins: [tailwindcss(), react()],
});
