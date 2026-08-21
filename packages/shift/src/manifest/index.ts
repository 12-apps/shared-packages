/**
 * `@12-apps/shift/manifest` — the SHARED wiring manifest.
 *
 * Identity, the Prisma contribution and the one runtime capability: `jobs`.
 * The HTTP surface deliberately stays undeclared — this package exports a
 * SERVICE (`createShiftService`), not route descriptors, and the origin
 * host's three shift routes are host code over that service; inventorying
 * `http` here would claim a factory that does not exist. No `mcp` (the
 * host's four shift tools are host-authored), no `permissions` (the ids the
 * routes check are host vocabulary), no `e2e` (no packaged journeys), no
 * `env` (zero `process.env` reads — every deployment decision is an
 * argument).
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
  server: ['jobs'],
} as const satisfies PackageManifest;
