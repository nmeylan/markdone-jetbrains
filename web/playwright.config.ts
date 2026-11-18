import { defineConfig, devices } from '@playwright/test';

/*
 * L2 tests run against the built bundle (`vite build --mode harness` -> web/dist-harness/), not the
 * dev server. test/e2e/fixtures.ts serves it as https://markdone.local/app/ through request routing,
 * with the CSP header of PLAN.md §6.3, and fails a test on any other request.
 */
export default defineConfig({
  testDir: 'test/e2e',
  outputDir: '../build/reports/playwright/results',
  // Screenshot baselines (M2). Fonts come from the system: compare with maxDiffPixelRatio.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}',
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../build/reports/playwright/html' }]],
  forbidOnly: !!process.env['CI'],
  // One worker: the L6 perf tests must not share the CPU with other tests.
  workers: 1,
  use: {
    baseURL: 'https://markdone.local/',
    headless: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
