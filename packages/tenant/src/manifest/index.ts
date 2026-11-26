/**
 * `@12-apps/tenant/manifest` — the SHARED wiring manifest.
 *
 * - `db` — the partial names no host table (the tenant id is an opaque
 *   string, no foreign key), so it composes into any host's schema folder.
 *
 * Every other capability is declined for now, each with its argument in
 * `.wiring-conformance.json`: the routes, jobs, mail, notifications,
 * permissions and screens arrive with the slices that add them.
 *
 * `@12-apps/wiring` is a TYPE-ONLY dependency here.
 */
import type { PackageManifest } from '@12-apps/wiring';

export const tenantManifest = {
  name: '@12-apps/tenant',
  contract: 1,
  db: { partial: 'prisma/tenant.prisma', migrations: 'prisma/migrations' },
} as const satisfies PackageManifest;
