import { defineConfig } from 'vitest/config';

/**
 * Unit tests live next to the code they cover, as src/**\/*.test.ts.
 * tests/integration holds cross-layer tests; tests/e2e belongs to Playwright.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'src/shared/**/*.test.ts',
            'src/domain/**/*.test.ts',
            'src/persistence/**/*.test.ts',
            'src/host/**/*.test.ts',
            'tools/**/*.test.ts',
            'tests/integration/**/*.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/web/**/*.test.ts', 'src/web/**/*.test.tsx'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'reports/coverage',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**', 'tools/**'],
    },
  },
});
