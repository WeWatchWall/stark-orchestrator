import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@stark-o/shared': path.resolve(__dirname, './packages/shared/src'),
      '@stark-o/core': path.resolve(__dirname, './packages/core/src'),
      '@stark-o/node-runtime': path.resolve(__dirname, './packages/node-runtime/src'),
      '@stark-o/browser-runtime': path.resolve(__dirname, './packages/browser-runtime/src'),
      '@stark-o/server': path.resolve(__dirname, './packages/server/src'),
      '@stark-o/cli': path.resolve(__dirname, './packages/cli/src'),
    },
  },
});
