import { defineConfig } from '@playwright/test';
import { loadEnv } from 'vite';

// Keep test selection and the Vite build in agreement, including local .env.
// Explicit CI variables (even an empty key) take precedence in loadEnv.
const env = loadEnv('production', process.cwd(), 'VITE_');
process.env.VITE_DROPBOX_APP_KEY = env.VITE_DROPBOX_APP_KEY?.trim() || '';

const subdirectory = process.env.MINIJOUR_TEST_SUBDIRECTORY === '1';
const basePath = process.env.VITE_BASE_PATH || (subdirectory ? '/minijour/' : env.VITE_BASE_PATH || '/');
const baseURL = `http://127.0.0.1:4173${basePath}`;

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
    env: { VITE_BASE_PATH: basePath },
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
