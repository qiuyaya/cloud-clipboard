import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/__tests__/**/*.{test,spec}.{js,ts}"],
    exclude: ["node_modules/**", "dist/**"],
    coverage: {
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,js}"],
      exclude: [
        "node_modules/",
        "src/**/__tests__/",
        "**/*.d.ts",
        "**/*.config.ts",
        "src/index.ts",
        "src/**/*.test.{ts,js}",
        "src/**/*.spec.{ts,js}",
      ],
      thresholds: {
        functions: 50,
        lines: 50,
        statements: 50,
        branches: 50,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
