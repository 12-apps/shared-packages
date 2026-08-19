import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';
import { authFeatures, authFeaturesRoot, authSteps } from '@12-apps/auth/e2e';
import {
  impersonationFeatures,
  impersonationFeaturesRoot,
  impersonationSteps,
} from '@12-apps/impersonation/e2e';
import { paymentsFeatures, paymentsFeaturesRoot, paymentsSteps } from '@12-apps/payments-e2e';
import { reportsFeatures, reportsFeaturesRoot, reportsSteps } from '@12-apps/report-builder/e2e';
import { defineBddConfig } from 'playwright-bdd';

import { HARNESS_BACKEND_ORIGIN, HARNESS_SPA_ORIGIN, HARNESS_SPA_PORT } from '../backend/src/port';

/** `harness/backend`, resolved from THIS file so the spawn ignores the cwd. */
const BACKEND_DIR = fileURLToPath(new URL('../backend', import.meta.url));

/**
 * The one directory every packaged suite's features sits under.
 *
 * `defineBddConfig` takes exactly ONE `featuresRoot` and mirrors each feature's
 * path relative to it under `outputDir`, so several packages shipping
 * journeys need a root that covers all of them. Computed rather than written down: each package
 * resolves its own feature directory (see its `globs.ts`), and where those land
 * is the installer's business, not this file's.
 *
 * Getting the root wrong fails loudly in one direction and silently in the
 * other, which is why the check below exists. A feature OUTSIDE the root is a
 * hard `exit` from bddgen ("All feature files should be located underneath
 * featuresRoot"). A root so high that the mirrored path still contains a
 * `node_modules` segment is the quiet one: bddgen reports every feature
 * compiled, Playwright's default `testIgnore` drops every resulting spec, and
 * the run is green with the whole packaged suite absent. That case is turned
 * into a throw here, where the message can say what actually happened.
 */
function journeysRoot(...featureDirs: string[]): string {
  const parts = featureDirs.map((dir) => dir.split(sep));
  const shared: string[] = [];
  const [first = []] = parts;
  for (const [index, segment] of first.entries()) {
    if (!parts.every((candidate) => candidate[index] === segment)) break;
    shared.push(segment);
  }
  const root = shared.join(sep);
  for (const dir of featureDirs) {
    if (relative(root, dir).split(sep).includes('node_modules')) {
      throw new Error(
        `The journeys in ${dir} would compile under a node_modules path, which ` +
          "Playwright's default testIgnore drops silently. Install the packaged " +
          'journeys somewhere that shares a root with the others.',
      );
    }
  }
  return root;
}

/**
 * Where the packaged journeys compile to (FUT-743), and where they come FROM
 * (FUT-561, FUT-755).
 *
 * The `.feature` files are the shopper's and the report author's own words;
 * `bddgen` COMPILES them into ordinary Playwright specs, which is why they
 * inherit everything below with nothing special wired up — same browser, same
 * web server, same reporters. Generation is not optional and not manual:
 * `npm test` runs `bddgen` first, so a feature either executes or the run is
 * red.
 *
 * The journeys themselves SHIP WITH THE LIBRARIES. This app runs them by
 * pointing at each package's own globs and implementing the port it asks for —
 * `PaymentsWorld` in `tests/e2e/steps/payments-world.ts`, `ReportsWorld` in
 * `tests/e2e/steps/reports-world.ts`. No feature and no step file is copied
 * here, so a scenario added upstream runs on the next version bump instead of
 * being quietly missed. That is the integration a real consumer performs, which
 * makes this app a test OF the contracts rather than a place they are re-stated.
 *
 * Every package glob is RESOLVED by the package rather than written as a
 * `node_modules/...` path: pnpm's store is nested, this app installs from
 * tarballs, and a glob that matches nothing fails SILENTLY — bddgen compiles
 * what it found, finds nothing, and the run is green with zero journeys.
 *
 * ONE project, not one per package. A Playwright project carries one `testDir`,
 * and playwright-bdd keys its configs by `outputDir` — two calls sharing one
 * would be rejected outright. Both suites drive the same origin against the
 * same web servers, so there is nothing a second project would express.
 *
 * `.features-gen` is generated and gitignored. Committing it would let a
 * scenario and its compiled spec drift.
 */
const journeys = defineBddConfig({
  features: [paymentsFeatures, reportsFeatures, impersonationFeatures, authFeatures],
  // Without this the compiled specs mirror each package's node_modules path and
  // Playwright's default testIgnore drops every one of them — bddgen reports
  // the features compiled and the journeys project collects nothing, green.
  featuresRoot: journeysRoot(
    paymentsFeaturesRoot,
    reportsFeaturesRoot,
    impersonationFeaturesRoot,
    authFeaturesRoot,
  ),
  // This app's own steps glob stays: it is where every `define…World` call
  // lives, and playwright-bdd imports every step file before the first Given.
  steps: [paymentsSteps, reportsSteps, impersonationSteps, authSteps, 'tests/e2e/steps/**/*.ts'],
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
    baseURL: HARNESS_SPA_ORIGIN,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  // The checkout polls its payment status every 2.5s against a real mount, so
  // an outcome legitimately arrives after Playwright's 5s default. Raised here
  // rather than per assertion: a timeout typed into a spec is a number nobody
  // can justify later, and it is the shape the flakiness gate rejects.
  expect: { timeout: 15_000 },
  /**
   * ONE WORKER, because there is ONE database (FUT-755).
   *
   * `harness/backend` holds a single PGlite, and the way anything touching it
   * gets a known starting point is `POST /__harness/reset`, which reseeds ALL
   * of it. Playwright spreads test FILES across workers, so a second worker's
   * reset lands in the middle of the first worker's scenario — and the reports
   * area is the half of this harness that writes: a report gets published, an
   * edit gets parked. The damage is invisible in the log and reads as a defect
   * in the package: "the working copy did not survive a new session" is
   * exactly what a wiped database looks like from inside the browser.
   *
   * It was already latent — `tests/report-builder.spec.ts` archives a report
   * and re-reads the list — and stayed hidden only because the reads it races
   * against see the same rows re-seeded. The journeys are the first specs whose
   * WRITE has to outlive the next step.
   *
   * Parallelism belongs back here the day the reset is per-tenant and each
   * worker owns one. Until then this is the honest setting, and a suite that is
   * slower is much cheaper than one that is occasionally wrong.
   */
  workers: 1,
  projects: [
    // Hand-written specs: the harness pages, addressed by slug.
    { name: 'harness', testDir: './tests' },
    // The same pages, driven by the Gherkin journeys compiled above.
    { name: 'journeys', testDir: journeys },
  ],
  /**
   * TWO servers, because the harness now has two halves.
   *
   * The reports surface used to answer itself: the package's Hono router was
   * mounted in the browser, so one `vite preview` was the whole world. It is a
   * real API on a real socket now, and `npm test` still has to be the one
   * command that runs the suite — so Playwright starts both and orders them by
   * listing them in dependency order.
   *
   * The backend's readiness probe is `/health`, which does not answer until
   * the migrations have run and the fixture is seeded. That is what stops the
   * first spec from racing the first migration: PGlite applies six migrations
   * on boot, and a spec that arrived early would see `relation saved_reports
   * does not exist` — a package failure, seemingly.
   *
   * THE SPA'S SERVER BUILDS THE SPA. `vite preview` serves `dist/`, and it
   * serves a stale one without a word, so the build belongs to whatever starts
   * the server rather than to the npm script that usually calls it. The three
   * npm scripts owned it until now, which left exactly one invocation uncovered
   * — and it is the one a person debugging a single failure reaches for.
   * `npx playwright test --project=harness tests/shell.spec.ts` never built:
   * with no `dist/` it fails loudly (preview answers 404 and this webServer
   * times out), and with a stale one it goes green against the previous run's
   * bundle. That has already cost a "164 passed" against a bundle predating the
   * changes under test, and eleven specs hidden behind element-not-found
   * timeouts after a merge added a page. Owning it here means no invocation can
   * skip it — `npm test`, a bare `playwright test`, one spec, one `--grep`, an
   * IDE's run button — because none of them can start the SPA any other way.
   */
  webServer: [
    {
      command: 'npm run start',
      cwd: BACKEND_DIR,
      url: `${HARNESS_BACKEND_ORIGIN}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run build && npx vite preview --port ${HARNESS_SPA_PORT} --strictPort`,
      url: HARNESS_SPA_ORIGIN,
      reuseExistingServer: false,
      // The build is inside this command now, so the window has to cover it:
      // ~10s of vite on top of the moment `preview` needs to bind.
      timeout: 120_000,
    },
  ],
});
