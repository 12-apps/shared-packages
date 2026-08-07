import { defineConfig } from '@playwright/test';
import { paymentsFeatures, paymentsFeaturesRoot, paymentsSteps } from '@12-apps/payments-e2e';
import { defineBddConfig } from 'playwright-bdd';

/**
 * Where the buyer journeys compile to (FUT-743), and where they come FROM
 * (FUT-561).
 *
 * The `.feature` files are the shopper's own words; `bddgen` COMPILES them into
 * ordinary Playwright specs, which is why they inherit everything below with
 * nothing special wired up — same browser, same web server, same reporters.
 * Generation is not optional and not manual: `npm test` runs `bddgen` first, so
 * a feature either executes or the run is red.
 *
 * The journeys themselves SHIP WITH THE LIBRARY. This app runs them by pointing
 * at the package's own globs and implementing `PaymentsWorld` in
 * `tests/e2e/steps/payments-world.ts` — no feature and no step file is copied
 * here, so a scenario added upstream runs on the next version bump instead of
 * being quietly missed. That is the integration a real consumer performs, which
 * makes this app a test OF the contract rather than a place the contract is
 * re-stated.
 *
 * Both package globs are RESOLVED by the package rather than written as
 * `node_modules/...` paths: pnpm's store is nested, this app installs from
 * tarballs, and a glob that matches nothing fails SILENTLY — bddgen compiles
 * what it found, finds nothing, and the run is green with zero journeys.
 *
 * `.features-gen` is generated and gitignored. Committing it would let a
 * scenario and its compiled spec drift.
 */
const journeys = defineBddConfig({
  features: [paymentsFeatures],
  // Without this the compiled specs mirror the package's node_modules path and
  // Playwright's default testIgnore drops every one of them — bddgen reports
  // seven features compiled and the journeys project collects nothing, green.
  featuresRoot: paymentsFeaturesRoot,
  // This app's own steps glob stays: it is where `definePaymentsWorld` is
  // called, and playwright-bdd imports every step file before the first Given.
  steps: [paymentsSteps, 'tests/e2e/steps/**/*.ts'],
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
