import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // The harness is a fixture, not a product: one browser is enough to prove the
  // packages mount, and cross-browser rendering belongs to @12-apps/ui's own suite.
  // Honour a browser the environment already provides. CI runs `playwright
  // install chromium` and leaves this unset; sandboxes that ship a pinned
  // Chromium set it rather than re-downloading one against a version the
  // preinstalled build does not match.
  use: {
    baseURL: 'http://localhost:4319',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  webServer: {
    command: 'npx vite preview --port 4319 --strictPort',
    url: 'http://localhost:4319',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
