/**
 * `@12-apps/impersonation/e2e` — the operator's and the previewer's journeys,
 * shipped.
 *
 * A host that mounts this surface inherits its end-to-end coverage by
 * implementing one port and adding two globs. Nothing is copied, so a scenario
 * added to the library later runs in every consumer on the next version bump.
 *
 * ```ts
 * // <your app>/tests/e2e/steps/impersonation-world.ts — inside your `steps` glob
 * import { defineImpersonationWorld } from '@12-apps/impersonation/e2e';
 *
 * defineImpersonationWorld({
 *   reset: async (page) => { ... },
 *   openStartDialog: async (page, subject) => { ... },
 *   startRolePreview: async (page, roleName) => { ... },
 *   startMemberPreview: async (page, memberUserId) => { ... },
 *   openGuardedScreen: async (page) => { ... },
 *   fixtures: { ... },
 * });
 * ```
 *
 * ```ts
 * // playwright.config.ts
 * defineBddConfig({
 *   features: [impersonationFeatures],
 *   featuresRoot: impersonationFeaturesRoot,
 *   steps: [impersonationSteps, 'tests/e2e/steps/**\/*.ts'],
 * });
 * ```
 *
 * A SUBPATH rather than a package of its own: the session, the banner and the
 * dialog all ship from here, so the journeys belong to the same package. A
 * second published name would be a release, a changelog and a version to keep in
 * step for no boundary that exists.
 *
 * The globs are exported rather than documented as strings so a consumer never
 * has to know this package's internal layout — and cannot be broken by it
 * moving.
 */
export {
  defineImpersonationWorld,
  impersonationWorld,
  type ImpersonationFixtures,
  type ImpersonationSubjectFixture,
  type ImpersonationWorld,
} from './world.js';

export {
  impersonationFeatures,
  impersonationFeaturesRoot,
  impersonationSteps,
} from './globs.js';
