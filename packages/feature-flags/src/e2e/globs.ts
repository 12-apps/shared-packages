import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Where this package's beta-cohort journeys and their steps live, ON DISK, in
 * the consumer's `node_modules` (the report-builder arrangement, for the same
 * reasons): `defineBddConfig` takes filesystem globs, not module specifiers,
 * and a hard-coded `node_modules/...` path is broken by pnpm's nested store,
 * by a workspace link, and by this package's own layout changing. Resolving
 * from the package's own exported `package.json` is correct under all three.
 */
const require_ = createRequire(import.meta.url);

function packageRoot(): string {
  return dirname(require_.resolve("@12-apps/feature-flags/package.json"));
}

/** Every packaged `.feature`, for `defineBddConfig({ features })`. */
export const featureFlagsFeatures: string = join(packageRoot(), "features/**/*.feature");

/**
 * For `defineBddConfig({ featuresRoot })` — REQUIRED, not decoration: left
 * unset, the compiled specs mirror a `node_modules` path that Playwright's
 * default `testIgnore` drops silently, and the run is green with the whole
 * suite absent. A host running several packaged suites hands bddgen the
 * directory they all sit under.
 */
export const featureFlagsFeaturesRoot: string = join(packageRoot(), "features");

/**
 * Every packaged step definition, for `defineBddConfig({ steps })` — the
 * COMPILED JavaScript, which is why this package has a build step at all
 * while everything else it exports is raw `.ts` through the `exports` map.
 */
export const featureFlagsSteps: string = join(packageRoot(), "dist/e2e/steps/**/*.js");
