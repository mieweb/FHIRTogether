import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for FHIR Scheduler Widget tests
 * 
 * Usage:
 *   npx playwright test
 * 
 * Prerequisites:
 *   - Test data is auto-generated if missing (via globalSetup)
 *   - Servers are auto-started (via webServer config)
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /* Use 1 worker to avoid slot hold conflicts between parallel tests */
  workers: 1,
  reporter: 'html',
  
  /* Auto-generate test data if missing */
  globalSetup: './tests/global-setup.ts',
  
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Start both servers before running tests */
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../..',  // FHIRTogether root
      url: 'http://localhost:4010/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
