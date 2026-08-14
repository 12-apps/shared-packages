import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Where this package's journeys and their steps live, ON DISK, in the consumer's
 * `node_modules`.
 *
 * `defineBddConfig` takes filesystem globs, not module specifiers — it hands
 * them to a glob matcher, so `'@12-apps/impersonation/features/**'` matches
 * nothing and, worse, matches nothing SILENTLY: bddgen compiles the features it
 * found, finds none, and the run is green with zero journeys.
 *
 * So the paths are RESOLVED here instead of written down by every consumer. A
 * host that hard-codes `node_modules/@12-apps/impersonation/...` is broken by
 * pnpm's nested store, by a workspace link, and by this package's own layout
 * changing; resolving from the package's own entry point is correct under all
 * three.
 */
const require_ = createRequire(import.meta.url);

/**
 * The package root, found from a file this package definitely exports.
 * `./package.json` is exported precisely so this lookup needs no guess about
 * directory depth.
 */
function packageRoot(): string {
  return dirname(require_.resolve('@12-apps/impersonation/package.json'));
}

/** Every packaged `.feature`, for `defineBddConfig({ features })`. */
export const impersonationFeatures: string = join(packageRoot(), 'features/**/*.feature');

/**
 * The base `defineBddConfig({ featuresRoot })` must be given, and it is NOT
 * optional decoration.
 *
 * bddgen mirrors each feature's path RELATIVE TO `featuresRoot` under
 * `outputDir`. Left unset it defaults to the config's own directory, so a
 * feature living under `node_modules/...` compiles to a path Playwright then
 * IGNORES, because its default `testIgnore` excludes `**\/node_modules/**`.
 *
 * The result is the worst kind of green: bddgen reports the features compiled,
 * Playwright collects zero specs from them, and the run passes with the whole
 * packaged suite silently absent.
 *
 * A host running SEVERAL packaged suites gives `featuresRoot` the directory they
 * all sit under, since bddgen takes exactly one — and that is safe to do,
 * because a feature outside it is a hard exit from bddgen, never a quiet
 * omission.
 */
export const impersonationFeaturesRoot: string = join(packageRoot(), 'features');

/**
 * Every packaged step definition, for `defineBddConfig({ steps })`.
 *
 * COMPILED JavaScript, and that is the reason this package has a build step at
 * all while everything else it exports is raw `.ts` through the `exports` map.
 * Those entries are consumed by an application's BUNDLER, which transpiles
 * whatever it is pointed at. These are loaded by NODE — `playwright.config.ts`
 * imports this module, and bddgen imports the step files — and Node refuses to
 * strip types from anything under `node_modules`
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). Playwright's own TS transform
 * does not rescue them either; it skips `node_modules` by design.
 *
 * The host's own steps glob must ALSO be listed — that is where its
 * `defineImpersonationWorld` call lives, and playwright-bdd imports every step
 * file before any scenario runs, which is what makes the registration land in
 * time in every worker.
 */
export const impersonationSteps: string = join(packageRoot(), 'dist/e2e/steps/**/*.js');
