/**
 * `@12-apps/report-builder/manifest` — the SHARED wiring manifest.
 *
 * Data every runtime can hold: identity, the permission contribution, the
 * Prisma contribution and the e2e pointer, plus the INVENTORY of the two
 * runtime manifests (`./manifest/server`, `./manifest/web`). A host adopts
 * this through `@12-apps/wiring/consumer`, and the inventory is what makes an
 * unanswered capability a red `assemble()` instead of a silent gap — the
 * working-copy endpoints shipped for a release with no host mounting them,
 * and nothing said so; this file is the mechanism that says so.
 *
 * Everything here is a declaration of what already exists: the permission
 * contribution is the same object `composePermissions` consumers import from
 * `/server`, and the Prisma paths are the ones `prisma:sync` copies. Nothing
 * moved; it is now findable by machines.
 */

import { defineManifest } from '@12-apps/wiring/producer';

import { REPORT_BUILDER_PERMISSIONS } from '../server/contribution';

export const reportBuilderManifest = defineManifest({
  name: '@12-apps/report-builder',
  contract: 1,
  permissions: REPORT_BUILDER_PERMISSIONS,
  db: { partial: 'prisma/report-builder.prisma', migrations: 'prisma/migrations' },
  e2e: { entry: '@12-apps/report-builder/e2e' },
  server: ['http'],
  web: ['surface', 'areas'],
});
