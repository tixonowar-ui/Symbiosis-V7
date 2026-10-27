import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * tsconfig `paths` only affect type resolution. Without these aliases,
 * `@shared/…` and `@generated/…` type-check but fail to resolve when a test
 * actually runs. They are repeated per project on purpose: with `projects`,
 * a root-level `resolve` does not reach the individual project configs.
 */
const alias = {
  '@shared': r('./src/shared'),
  '@generated': r('./generated'),
};

/**
 * Unit tests live next to the code they cover, as src/**\/*.test.ts.
 * tests/integration holds cross-layer tests; tests/e2e belongs to Playwright.
 *
 * Note: a test file at the repository root matches no project and is silently
 * not run. Put tests beside the code they cover.
 */
export default defineConfig({
  test: {
    // Seven concurrent suites caused native Atlas clone allocation failures on
    // Windows 8 CPU / 16 GiB. Four preserve the full suite with lower peak memory.
    // Measurements and limits of this budget: docs/status/vitest-atlas-memory.md.
    maxWorkers: Math.min(4, Math.max(availableParallelism() - 1, 1)),
    projects: [
      {
        resolve: { alias },
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
        resolve: { alias },
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
