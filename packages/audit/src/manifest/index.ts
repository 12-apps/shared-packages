/**
 * `@12-apps/audit/manifest` — the SHARED wiring manifest.
 *
 * Identity and the Prisma contribution: one model, `audit_logs`, plus the
 * migration that created it.
 *
 * WHY THIS EXISTS, and why it is a manifest rather than a line of JSON. This
 * package's partial was already reaching an adopting host's schema — through
 * the assembler's STRUCTURAL DISCOVERY fallback, the path it takes for a
 * package that declares nothing. That fallback is why the gap stayed
 * invisible: composition succeeded, the table existed, every migration ran,
 * and nothing anywhere recorded that a package had put a table in someone
 * else's database. The db contract's whole claim is that a package's models
 * arrive because it SAID SO, and a contribution nobody declared is the drift
 * the contract exists to prevent, one release away from a rename that
 * silently orphans a copy.
 *
 * Declaring changes no host's behaviour: the assembler reads the declaration
 * where it used to scan, finds the same file, and composes the same model.
 * What changes is that the copy now answers to something.
 *
 * DATA ONLY — no `server` or `web` inventory, deliberately. This package does
 * ship an HTTP surface (`createApiAudit`, two descriptors), and declaring it
 * is a separate adoption: the inventory is what `assemble()` holds a host to,
 * so listing `http` here would turn every adopting host red until it bound a
 * surface it may be mounting by hand today. A pure-data manifest is also why
 * there is no `observability` namespace — the contract exempts manifests that
 * ship no running code, because a namespace with nothing logging under it is
 * a declaration about nobody.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency, with the peer that entitles
 * a consumer to it (the report-builder move): the manifest is a plain
 * `satisfies`-checked value, and the producer factories' runtime assertions
 * run in this package's own test suite.
 */

import type { PackageManifest } from '@12-apps/wiring';

export const auditManifest = {
  name: '@12-apps/audit',
  contract: 1,
  db: { partial: 'prisma/audit.prisma', migrations: 'prisma/migrations' },
} as const satisfies PackageManifest;
