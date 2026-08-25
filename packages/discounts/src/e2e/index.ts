/**
 * `@12-apps/discounts/e2e` — the packaged promotions journeys and the port a
 * host implements to run them.
 *
 * The `e2e` capability the manifest declares. A host adds the three globs to
 * its bdd config and calls `defineDiscountsWorld` from inside its own steps
 * glob; every scenario this package ships then runs in that host, including the
 * ones added after it integrated. Nothing is copied, so nothing can rot.
 */
export { discountsFeatures, discountsFeaturesRoot, discountsSteps } from './globs.js';
export {
  defineDiscountsWorld,
  discountsWorld,
  type DiscountsFixtures,
  type DiscountsWorld,
} from './world.js';
