import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/__tests__/**/*.{test,spec}.{js,ts,tsx}'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'tests/e2e/**',
      '**/*.e2e.{test,spec}.{js,ts}',
    ],
    coverage: {
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'src/test/',
        'src/__tests__/',
        '**/*.d.ts',
        '**/*.config.ts',
        'src/main.tsx',
        'src/main-desktop.tsx',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/vite-env.d.ts',
        'src/desktop/**',
        'src/components/ClipboardRoom.tsx',
        'src/components/RoomJoin.tsx',
        'src/components/LanguageToggle.tsx',
        'src/components/ThemeToggle.tsx',
        'src/components/ui/dropdown-menu.tsx',
        'src/components/ui/toast.tsx',
        'src/components/ui/toaster.tsx',
        'src/hooks/useTheme.tsx',
        'src/hooks/useToast.tsx',
        'src/i18n/**',
        'src/App.tsx',
      ],
      thresholds: {
        functions: 30,
        lines: 30,
        statements: 30,
        branches: 30,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});