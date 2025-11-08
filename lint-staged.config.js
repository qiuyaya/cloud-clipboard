// Lint-staged configuration for pre-commit hooks
export default {
  // TypeScript and JavaScript files
  "**/*.{ts,tsx,js,jsx}": [
    "prettier --write", // Auto-format code
    "eslint --fix", // Auto-fix linting issues
  ],
  // JSON, CSS, SCSS, HTML, MD files
  "**/*.{json,css,scss,html,md,yml,yaml}": [
    "prettier --write", // Auto-format configuration files
  ],
  // Type declaration files
  "**/*.d.ts": [
    "prettier --write", // Format type definitions
  ],
  // Run type checking on all TS files (don't auto-fix, just check)
  "**/*.{ts,tsx}": [
    "tsc --noEmit --skipLibCheck --skipDefaultLibCheck", // Type check
  ],
};
