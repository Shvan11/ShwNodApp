import { defineConfig, devices } from '@playwright/test';

/**
 * Read-only smoke flows against an ALREADY-RUNNING server.
 *
 * There is deliberately NO `webServer` block: booting a second Express
 * instance on this machine would double-run the long-lived services (WhatsApp
 * client, CDC sync engines) against the live database. Target the instance
 * that's already up:
 *   - default: the production service on http://localhost:3000
 *   - dev:     $env:E2E_BASE_URL = 'http://localhost:5173'; npm run test:e2e
 *
 * Because the default target is LIVE, specs in e2e/ must stay READ-ONLY —
 * login + navigation + render assertions. No mutations.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'smoke',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/admin.json',
      },
    },
  ],
});
