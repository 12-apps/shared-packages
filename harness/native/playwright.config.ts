import { defineConfig } from '@playwright/test';

/**
 * Drives the WEB export of the Expo app: `expo export --platform web` writes
 * `dist/web`, a static bundle Metro built with the `react-native` condition
 * forced on (see metro.config.js), so what the browser renders is the native
 * `@12-apps/ui` through react-native-web — not the MUI build the Vite harness
 * renders. The export runs inside `webServer.command` for the same reason the
 * frontend harness builds inside it: every entry point, including a single
 * `npx playwright test <spec>`, then goes through a fresh build.
 *
 * `HARNESS_CHROMIUM_PATH` points the browser launch at a pre-installed Chromium
 * on a machine that has one and cannot download the exact build Playwright
 * wants; unset (CI installs the exact build), Playwright's own resolution runs.
 */
const PORT = Number(process.env.HARNESS_NATIVE_PORT ?? 4330);
const executablePath = process.env.HARNESS_CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: `npm run export:web && npx --yes serve dist/web -l ${PORT} --no-clipboard --single`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', viewport: { width: 420, height: 900 } } }],
});
