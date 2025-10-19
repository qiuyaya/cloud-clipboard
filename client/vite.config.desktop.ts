import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Mock PWA virtual module for desktop builds
      "virtual:pwa-register/react": path.resolve(__dirname, "./src/__mocks__/pwa-register.ts"),
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: path.resolve(__dirname, "index-desktop.html"),
    },
  },
  define: {
    "process.env": {},
  },
});
