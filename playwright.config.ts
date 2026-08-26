import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  // One retry on CI only. This check drives three real sign-ins and several full page loads
  // against a freshly built server, and it has stalled once on a commit that changed nothing
  // but a Markdown file, so a lone stall must not be reported as a broken agreement boundary.
  // A failure that repeats is still a failure; locally there is no retry, so flakiness stays
  // visible to whoever is working on it.
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/artifacts',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  reporter: process.env.CI ? [['line']] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3000',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run build && npm run start -- --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
