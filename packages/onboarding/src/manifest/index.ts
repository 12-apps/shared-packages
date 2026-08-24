/**
 * `@12-apps/onboarding/manifest` — the SHARED wiring manifest.
 *
 * Identity, the Prisma contribution and the runtime inventory: `http` on the
 * server. The progress surface is the whole of it — two endpoints over one
 * owned model — which is why this manifest is short and says so explicitly
 * rather than leaving an adopter to wonder what it left out:
 *
 * - **No `permissions`.** The tenant-admin gate this surface sits behind is
 *   the HOST's (`requireTenantAdminBySlug` at the origin), decided before a
 *   descriptor is reached. The package contributes no ids of its own, so a
 *   declaration here would be inventing policy vocabulary for every adopter.
 * - **No `env`.** `resetEnabled` is a config SEAM whose default consults
 *   `NODE_ENV`; the host decides what "development" means by passing its own
 *   predicate. `NODE_ENV` itself is platform vocabulary, not a contribution
 *   — the same call `@12-apps/realtime`'s manifest makes.
 *
 * The `web` inventory used to be a third narrowing here, on a false premise:
 * that listing it would oblige every SERVER host to answer for a React surface
 * it never mounts. The consumer reports a capability declared for the OTHER
 * runtime as `out-of-scope` and returns; only an applicable, unanswered one is
 * `unbound`. What the narrowing actually cost was the declaration of
 * `OnboardingProvider` and `GuidedSection` — and, until now, the `createWeb*`
 * factory the contract's `surface` capability names, which this package had
 * never grown. `./manifest/web` declares it.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifest is a plain `satisfies`-checked value, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from "@12-apps/wiring";

export const onboardingManifest = {
  name: "@12-apps/onboarding",
  contract: 1,
  db: { partial: "prisma/onboarding.prisma", migrations: "prisma/migrations" },
  /**
   * Mandatory for runtime manifests since wiring 1.3.0: a progress write that
   * fails files under `onboarding`, not nowhere.
   */
  observability: { namespace: "onboarding" },
  server: ["http"],
  web: ["surface"],
} as const satisfies PackageManifest;
