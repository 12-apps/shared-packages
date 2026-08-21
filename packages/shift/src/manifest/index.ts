/**
 * `@12-apps/shift/manifest` — the SHARED wiring manifest.
 *
 * Identity, the Prisma contribution and the two runtime capabilities:
 * `http` and `jobs`. The HTTP surface is `createApiShift` (`./http`): the
 * three descriptors that used to be origin-host route files, over a port the
 * host implements with its policy layer. What the routes deliberately do NOT
 * declare is policy: which permission gates a close depends on the request
 * BODY's mode, so the guards stay in the host's adapter, and the ids it
 * checks stay host vocabulary — which is also why there is still no
 * `permissions` contribution. No `mcp` (the host's four shift tools are
 * host-authored), no `e2e` (no packaged journeys), no `env` (zero
 * `process.env` reads — every deployment decision is an argument). The
 * host's station-switch route stays host code too: it is that host's
 * resource vocabulary end to end.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifests are plain `satisfies`-checked values, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from '@12-apps/wiring';

export const shiftManifest = {
  name: '@12-apps/shift',
  contract: 1,
  db: { partial: 'prisma/shift.prisma', migrations: 'prisma/migrations' },
  /**
   * Mandatory for runtime manifests since wiring 1.3.0: a sweep that fails
   * files under `shift`, not nowhere.
   */
  observability: { namespace: 'shift' },
  server: ['http', 'jobs'],
} as const satisfies PackageManifest;
