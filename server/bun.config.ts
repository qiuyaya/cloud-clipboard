export default {
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/**/*.d.ts",
        "src/index.ts", // Main entry point, hard to test in isolation
      ],
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      thresholds: {
        functions: 75,
        lines: 75,
        statements: 75,
        branches: 65,
      },
    },
  },
};
