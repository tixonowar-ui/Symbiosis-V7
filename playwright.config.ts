import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the renderer against a real host process.
 * Each scenario starts an isolated host and SQLite database through fixtures,
 * so a shared webServer would break that isolation.
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './reports/e2e-artifacts',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: [
    [process.env['CI'] ? 'github' : 'list'],
    ['html', { outputFolder: './reports/playwright-report', open: 'never' }],
  ],
  use: {
    // Keep the failing first attempt even when the retry succeeds.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
