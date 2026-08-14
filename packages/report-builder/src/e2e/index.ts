/**
 * `@12-apps/report-builder/e2e` — the report author's journeys, shipped
 * (FUT-755).
 *
 * A host that mounts the reports surface inherits its end-to-end coverage by
 * implementing one port and adding two globs. Nothing is copied, so a scenario
 * added to the library later runs in every consumer on the next version bump.
 *
 * ```ts
 * // <your app>/tests/e2e/steps/reports-world.ts  — inside your `steps` glob
 * import { defineReportsWorld } from '@12-apps/report-builder/e2e';
 *
 * defineReportsWorld({
 *   reset: async (page) => { ... },
 *   openReports: async (page) => { ... },
 *   openInNewSession: async (browser) => { ... },
 *   fixtures: { ... },
 * });
 * ```
 *
 * ```ts
 * // playwright.config.ts
 * defineBddConfig({
 *   features: [reportsFeatures],
 *   featuresRoot: reportsFeaturesRoot,
 *   steps: [reportsSteps, 'tests/e2e/steps/**\/*.ts'],
 * });
 * ```
 *
 * A SUBPATH rather than a package of its own, unlike the payments journeys.
 * Those had to be separate: the checkout ships from `@12-apps/payments-frontend`
 * and its journeys drive `@12-apps/payments-backend` too, so neither half owned
 * them. The reports surface, its server routes and its screens are all one
 * package, so the journeys belong to it — and a second published name would be
 * a release, a changelog and a version to keep in step for no boundary that
 * exists.
 *
 * The globs are exported rather than documented as strings so a consumer never
 * has to know this package's internal layout — and cannot be broken by it
 * moving.
 */
export {
  defineReportsWorld,
  reportsWorld,
  type ReportsBlockTemplate,
  type ReportsFixtures,
  type ReportsWorld,
} from './world.js';

export { reportsFeatures, reportsFeaturesRoot, reportsSteps } from './globs.js';
