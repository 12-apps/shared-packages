/**
 * `@12-apps/entitlements/manifest` — the SHARED wiring manifest.
 *
 * Identity, the Prisma contribution (the retention watermark) and the runtime
 * inventory: `http` on the server. Two narrowings are deliberate:
 *
 * - **No static `permissions`.** This package contributes exactly one id
 *   (`plan:request`), but its contribution is a FACTORY —
 *   `entitlementsPermissions(labels)` (`../server/contribution`) — because
 *   the label segments render in the host's role editor and are therefore
 *   host copy. A static declaration here would compile one application's
 *   vocabulary into every adopter's catalog through the composition merge,
 *   which is the copy-portability doctrine's named failure. A pt-BR host
 *   passes `PT_BR_ENTITLEMENTS_PERMISSION_LABELS` at the same seam it
 *   assembles the rest of its catalog at, and that stays a line in its diff.
 * - **No `web` inventory**, though `./react` ships the plan screens. Listing
 *   it would oblige every SERVER host adopting this manifest to answer for a
 *   React surface it never mounts — `assemble()` refuses a declared-but-
 *   unanswered capability, so the inventory must not overstate.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifest is a plain `satisfies`-checked value, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from '@12-apps/wiring';

export const entitlementsManifest = {
  name: '@12-apps/entitlements',
  contract: 1,
  db: { partial: 'prisma/entitlements.prisma', migrations: 'prisma/migrations' },
  /**
   * Mandatory for runtime manifests since wiring 1.3.0: a refused plan change
   * or a failed retention sweep files under `entitlements`, not nowhere.
   */
  observability: { namespace: 'entitlements' },
  server: ['http'],
} as const satisfies PackageManifest;
