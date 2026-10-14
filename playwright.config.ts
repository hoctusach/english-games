import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production build, with YouTube replaced by a
// fake player (e2e/fake-youtube.js), so they need no network.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/english-shoot-words/',
    serviceWorkers: 'block',
    locale: 'vi-VN',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/english-shoot-words/',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
