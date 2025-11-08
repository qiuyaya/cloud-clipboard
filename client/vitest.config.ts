import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "happy-dom",
    types: ["node"],
    setupFiles: [path.resolve(__dirname, "./src/test/setup.ts")],
    include: ["src/**/__tests__/**/*.{test,spec}.{js,ts,tsx}"],
    exclude: ["node_modules/**", "dist/**", "tests/e2e/**", "**/*.e2e.{test,spec}.{js,ts}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
