import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

/**
 * Where the buyer journeys compile to (FUT-743).
 *
 * The `.feature` files are the shopper's own words; `bddgen` COMPILES them into
 * ordinary Playwright specs, which is why they inherit everything below with
 * nothing special wired up — same browser, same web server, same reporters.
 * Generation is not optional and not manual: `npm test` runs `bddgen` first, so
 * a feature in this repo either executes or the run is red.
 *
 * `.features-gen` is generated and gitignored. Committing it would let a
 * scenario and its compiled spec drift.
 */
const journeys = defineBddConfig({
  features: 'tests/e2e/features/**/*.feature',
  steps: 'tests/e2e/steps/**/*.ts',
  outputDir: '.features-gen',
});

export default defineConfig({
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
  // The checkout polls its payment status every 2.5s against a real mount, so
  // an outcome legitimately arrives after Playwright's 5s default. Raised here
  // rather than per assertion: a timeout typed into a spec is a number nobody
  // can justify later, and it is the shape the flakiness gate rejects.
  expect: { timeout: 15_000 },
  projects: [
    // Hand-written specs: the harness pages, addressed by slug.
    { name: 'harness', testDir: './tests' },
    // The same pages, driven by the Gherkin journeys compiled above.
    { name: 'journeys', testDir: journeys },
  ],
  webServer: {
    command: 'npx vite preview --port 4319 --strictPort',
    url: 'http://localhost:4319',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
