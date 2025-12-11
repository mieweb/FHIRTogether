import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for FHIR Scheduler Widget tests
 * 
 * Usage:
 *   npx playwright test
 * 
 * Prerequisites:
 *   - FHIRTogether server: npm run dev (from project root)
 *   - Vite dev server: npm run dev (from packages/fhir-scheduler)
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  
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
