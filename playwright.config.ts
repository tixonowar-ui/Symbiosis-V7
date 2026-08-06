import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the renderer against a real host process.
 * The host is not wired up yet, so no webServer is configured here — add one
 * once src/host has an entry point.
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './reports/e2e-artifacts',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: './reports/playwright-report', open: 'never' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
