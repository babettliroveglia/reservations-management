import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './helpers';

// Each run keeps its results in its own folder, named by its start time in Italy; reports/latest links
// to the newest (as in tenutaroveglia-testing).
process.env.TEST_RUN_STAMP ||= new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).replace(' ', '_').replace(/:/g, '-');
const RUN_DIR = `reports/runs/${process.env.TEST_RUN_STAMP}`;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  outputDir: './test-results',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // One worker: the tests share one database, and some fill a time slot on purpose.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.argv.includes('--list') ? [['list']] : [
    ['list'],
    ['html', { outputFolder: `${RUN_DIR}/playwright-html`, open: 'never' }],
    ['json', { outputFile: `${RUN_DIR}/results.json` }],
    ['./reporters/issues-reporter.ts', { outputDir: RUN_DIR }],
  ],
  use: {
    baseURL: BASE_URL,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'api', testDir: './api' },
    { name: 'desktop', testDir: '.', testIgnore: /api\//, use: { ...devices['Desktop Chrome'] } },
    // Staff use the admin at a desk: the admin tests don't repeat on mobile.
    { name: 'mobile', testDir: './ui', use: { ...devices['Pixel 7'] } },
  ],
});
