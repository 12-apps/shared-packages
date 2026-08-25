/**
 * `@12-apps/rbac/e2e` — the roster's and the catalog's journeys, shipped.
 *
 * A host that mounts this surface inherits its end-to-end coverage by
 * implementing one port and adding two globs. Nothing is copied, so a scenario
 * added here later runs in every consumer on the next version bump.
 *
 * It replaces three hand-written specs in the origin host — `team.e2e.ts`,
 * `team-roles.e2e.ts` and `roles.e2e.ts` — which asserted on this package's own
 * test ids from outside it. That arrangement has one failure mode and it is
 * silent from the package's side: rename an id in here and a spec the package
 * cannot see goes red in a repo the package does not build.
 *
 * ```ts
 * // <your app>/tests/e2e/steps/rbac-world.ts — inside your `steps` glob
 * import { defineRbacWorld } from '@12-apps/rbac/e2e';
 *
 * defineRbacWorld({
 *   signInAsManager: async (page) => { ... },
 *   openTeamScreen: async (page) => { ... },
 *   openRolesScreen: async (page) => { ... },
 *   fixtures: { ... },
 * });
 * ```
 *
 * A SUBPATH rather than a package of its own, for the reason the impersonation
 * journeys give: the screens ship from here, so the journeys belong to the same
 * package. A second published name would be a release, a changelog and a
 * version to keep in step for no boundary that exists.
 */
export {
  defineRbacWorld,
  rbacWorld,
  type RbacFixtures,
  type RbacMemberFixture,
  type RbacWorld,
} from './world.js';

export { rbacFeatures, rbacFeaturesRoot, rbacSteps } from './globs.js';
