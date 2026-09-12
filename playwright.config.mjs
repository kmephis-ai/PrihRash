import { defineConfig } from '@playwright/test';

const previewUrl = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  outputDir: '.artifacts/playwright/test-results',
  reporter: [['list']],
  use: {
    baseURL: previewUrl,
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'node scripts/serve-r2-ui-preview.mjs',
    url: `${previewUrl}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
