import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end browser tests for the web client.
 *
 * These specs drive the real React app in Chromium against the live dev server
 * (`vite`), which proxies `/api` to the API gateway on :8080. A whole stack
 * (gateway + account/payment/catalog/order services + Postgres) must already be
 * running: the specs assert on real money movements, not on mocks.
 *
 * `reuseExistingServer` keeps the suite usable both ways — whether a `pnpm dev`
 * is already up or Playwright has to start one itself.
 */
export default defineConfig({
  testDir: './e2e',
  // The specs share one backend (one demo user, one cart, one ledger), so they
  // run strictly one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  /**
   * In CI the `github` reporter is added on purpose: it turns every failing test
   * into a check annotation, so the failure is visible on the commit — and, unlike
   * the job log, readable through the API without a token.
   */
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    testIdAttribute: 'data-testid',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
