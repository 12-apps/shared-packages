/**
 * `@12-apps/feature-flags/e2e` — the packaged beta-cohort journeys (FUT-884).
 *
 * The `.feature` files under `features/` are the operator's own story; the
 * steps compiled into `dist/e2e/steps/` drive this package's screen by its
 * test ids. A host runs them by implementing {@link FeatureFlagsWorld} once
 * and pointing its bdd config at the exported globs:
 *
 * ```ts
 * // playwright.config.ts
 * defineBddConfig({
 *   features: [featureFlagsFeatures],
 *   featuresRoot: featureFlagsFeaturesRoot,
 *   steps: [featureFlagsSteps, 'tests/e2e/steps/**\/*.ts'],
 * });
 * ```
 *
 * A SUBPATH rather than a package of its own (the report-builder call): the
 * flags surface, its server routes and its screens are all one package, so
 * the journeys belong to it. The globs are exported rather than documented as
 * strings so a consumer never has to know this package's internal layout.
 */
export {
  defineFeatureFlagsWorld,
  featureFlagsWorld,
  type FeatureFlagsFixtures,
  type FeatureFlagsFlagRef,
  type FeatureFlagsPersonRef,
  type FeatureFlagsWorld,
} from "./world.js";

export { featureFlagsFeatures, featureFlagsFeaturesRoot, featureFlagsSteps } from "./globs.js";
