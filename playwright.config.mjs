import { defineConfig } from '@playwright/test';

const reportDir = process.env.PLAYWRIGHT_REPORT_DIR || 'test-reports/latest';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  outputDir: `${reportDir}/artifacts`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${reportDir}/results.json` }],
    ['html', { outputFolder: `${reportDir}/html`, open: 'never' }],
  ],
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    headless: true,
    viewport: { width: 1440, height: 960 },
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
