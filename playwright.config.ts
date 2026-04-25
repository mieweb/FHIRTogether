import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for FHIRTogether server E2E tests
 *
 * Tests the HL7 Message Tester page and other server-rendered pages.
 *
 * Usage:
 *   npx playwright test                 # run all
 *   npx playwright test --ui            # interactive mode
 *   npx playwright test --headed        # visible browser
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:4010',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Start the FHIRTogether server before running tests */
  webServer: {
    command: 'npm start',
    url: 'http://localhost:4010/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
