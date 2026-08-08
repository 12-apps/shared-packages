import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Where this package's features and steps live, ON DISK, in the consumer's
 * `node_modules` (FUT-561).
 *
 * `defineBddConfig` takes filesystem globs, not module specifiers — it hands
 * them to a glob matcher, so `'@12-apps/payments-e2e/features/**'` matches
 * nothing and, worse, matches nothing SILENTLY: bddgen compiles the features it
 * found, finds none, and the run is green with zero journeys.
 *
 * So the paths are RESOLVED here instead of written down by every consumer.
 * A host that hard-codes `node_modules/@12-apps/payments-e2e/...` is broken by
 * pnpm's nested store, by a workspace link, and by this package's own layout
 * changing; resolving from the package's own entry point is correct under all
 * three.
 */
const require_ = createRequire(import.meta.url);

/**
 * The package root, found from a file this package definitely exports.
 *
 * `./package.json` is exported precisely so this lookup needs no guess about
 * directory depth — see the `exports` map.
 */
function packageRoot(): string {
  return dirname(require_.resolve('@12-apps/payments-e2e/package.json'));
}

/** Every packaged `.feature`, for `defineBddConfig({ features })`. */
export const paymentsFeatures: string = join(packageRoot(), 'features/**/*.feature');

/**
 * The base `defineBddConfig({ featuresRoot })` must be given, and it is NOT
 * optional decoration.
 *
 * bddgen mirrors each feature's path RELATIVE TO `featuresRoot` under
 * `outputDir`. Left unset it defaults to the config's own directory, so a
 * feature living in `node_modules/@12-apps/payments-e2e/features/x.feature`
 * compiles to `.features-gen/node_modules/@12-apps/payments-e2e/features/
 * x.feature.spec.js` — a path Playwright then IGNORES, because its default
 * `testIgnore` excludes `**\/node_modules/**`.
 *
 * The result is the worst kind of green: bddgen reports seven features
 * compiled, Playwright collects zero specs from them, and the run passes with
 * the whole packaged suite silently absent. Pointing `featuresRoot` here makes
 * the specs land flat in `outputDir`, where they are collected.
 */
export const paymentsFeaturesRoot: string = join(packageRoot(), 'features');

/**
 * Every packaged step definition, for `defineBddConfig({ steps })`.
 *
 * COMPILED JavaScript, and that is the reason this package has a build step at
 * all while its siblings ship raw `.ts` through their `exports` map. Those are
 * consumed by an application's BUNDLER, which transpiles whatever it is
 * pointed at. These are loaded by NODE — `playwright.config.ts` imports this
 * module, and bddgen imports the step files — and Node refuses to strip types
 * from anything under `node_modules`:
 *
 *     ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
 *
 * Playwright's own TS transform does not rescue them either; it skips
 * `node_modules` by design. Shipping `src/**\/*.ts` here produces a package
 * that type-checks, publishes, installs, and then throws on the consumer's
 * first test run.
 *
 * The host's own steps glob must ALSO be listed — that is where its
 * `definePaymentsWorld` call lives, and playwright-bdd imports every step file
 * before any scenario runs, which is what makes the registration land in time
 * in every worker.
 */
export const paymentsSteps: string = join(packageRoot(), 'dist/steps/**/*.js');

/**
 * The PLATFORM-OPERATIONS journeys (FUT-479 / FUT-483, packaged by FUT-573),
 * as a SEPARATE opt-in glob triple.
 *
 * Separate on purpose, twice over. The buyer journeys above run in any app
 * that mounts the checkout; these run in the app that operates the PLATFORM
 * (typically a super-admin SPA), and most checkout consumers have none.
 * Folding them into `paymentsFeatures` would hand every existing host
 * scenarios whose steps it never registered — bddgen fails on the undefined
 * steps — and folding the steps into `paymentsSteps` would hand it orphan
 * definitions instead, which is what a strict bdd gate fails on. A host that
 * wants these lists all three, next to `definePaymentsPlatformWorld`:
 *
 * ```ts
 * defineBddConfig({
 *   features: [paymentsPlatformFeatures],
 *   featuresRoot: paymentsPlatformFeaturesRoot,
 *   steps: [paymentsPlatformSteps, 'tests/e2e/steps/**\/*.ts'],
 * });
 * ```
 */
export const paymentsPlatformFeatures: string = join(
  packageRoot(),
  'features-platform/**/*.feature',
);

/** Same trap as {@link paymentsFeaturesRoot} — unset, the specs land under a path Playwright ignores. */
export const paymentsPlatformFeaturesRoot: string = join(packageRoot(), 'features-platform');

/** Compiled for Node, like {@link paymentsSteps} and for the same reason. */
export const paymentsPlatformSteps: string = join(packageRoot(), 'dist/steps-platform/**/*.js');
