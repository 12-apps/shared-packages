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
 * - **No static `notifications` capability**, though this package owns the
 *   `plan.changed` event. Its words are host copy — a tenant reads what its
 *   plan moved to in its own language — so it ships as the factory
 *   `createPlanChangedBlueprint(copy)` (`../server/notifications`), the same
 *   carve-out the permission contribution above makes for the same reason.
 *
 * The `web` inventory used to be a third narrowing, claiming a SERVER host
 * would be obliged to answer for a React surface it never mounts. It would
 * not: the consumer reports the other runtime's capabilities as `out-of-scope`
 * and only an applicable, unanswered one is `unbound`. The narrowing protected
 * nothing and made the plan screens undeclarable; `./manifest/web` declares
 * them now.
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
  web: ['surface', 'areas'],
} as const satisfies PackageManifest;
