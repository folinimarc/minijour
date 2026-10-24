import { defineConfig } from '@playwright/test';

const subdirectory = process.env.MINIJOUR_TEST_SUBDIRECTORY === '1';
const baseURL = subdirectory ? 'http://127.0.0.1:4173/minijour/' : 'http://127.0.0.1:4173/';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    timezoneId: 'Europe/Zurich',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: subdirectory
      ? 'npm run build && npm run preview -- --port 4173 --strictPort --base=/minijour/'
      : 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
