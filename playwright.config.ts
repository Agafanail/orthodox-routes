import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  // No retry, deliberately. The fixture is built once per run and its sign-in links are
  // one-use, so a second attempt signs in with links the first attempt already spent and can
  // only fail. A retry here would not rescue a flaky run; it would just append a misleading
  // second failure to a real one.
  retries: 0,
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
    // A failing run keeps its trace. The timeout report names only where the clock ran out
    // rather than what was waiting, and with no retry to trace instead, the failing attempt
    // itself has to carry the evidence.
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'npm run build && npm run start -- --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
