import js from "@eslint/js";
import typescriptParser from "@typescript-eslint/parser";

export default [
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      "no-console": "off", // Allow console statements for debugging
      "no-unused-vars": "off", // Turn off base rule to avoid conflicts
      "no-undef": "off", // TypeScript handles this
      "no-constant-binary-expression": "off", // Allow intentional constant expressions in tests
    },
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        module: "readonly",
        require: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        console: "readonly",
        Buffer: "readonly",
        global: "readonly",
        exports: "readonly",
      },
    },
  },
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "**/*.d.ts",
      "client/dist/**",
      "client/dev-dist/**",
      "server/dist/**",
      "shared/dist/**",
      "desktop/dist/**",
      "desktop/src-tauri/target/**",
      "desktop/src-tauri/**",
      "client/test-results/**",
      "client/playwright-report/**",
      "server/uploads/**",
      "server/public/**",
      "uploads/**",
      ".history/**",
      "*.config.js",
      "*.config.ts",
      "client/public/**",
      "assets/**",
      "server-rust/**",
    ],
  },
];
