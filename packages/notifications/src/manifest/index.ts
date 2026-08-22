/**
 * `@12-apps/notifications/manifest` — the SHARED wiring manifest.
 *
 * Identity, the Prisma contribution (the four owned models) and the runtime
 * inventory: `http` on the server. Three narrowings are deliberate:
 *
 * - **No `notifications` blueprints.** This package is the notification
 *   MECHANISM — the inbox, the preference matrix, the transports, the retry
 *   sweep — not an author of alerts. The blueprints belong to whichever
 *   package raises the alert (`@12-apps/product-research`'s budget warning
 *   ships as a factory over host copy for exactly this reason), and this one
 *   takes them through the `generators` seam at mount.
 * - **No `email` capability.** The transports are host-supplied config
 *   (`config.transports`, `config.drivers`), so what would be declared here
 *   is a seam the host already fills — and declaring it would oblige an
 *   adopter to bind a mailer this package never owns.
 * - **No `web` inventory**, though `./react` ships the bell and the
 *   preference screens. Listing it would oblige every SERVER host adopting
 *   this manifest to answer for a React surface it never mounts —
 *   `assemble()` refuses a declared-but-unanswered capability, so the
 *   inventory must not overstate.
 *
 * ON THE `db` DECLARATION. The origin host already composes
 * `prisma/notifications.prisma` into its schema — but by STRUCTURAL
 * DISCOVERY, the assembler's fallback for a package that declares nothing.
 * That fallback is why the gap was invisible: four tables reached a host's
 * database with no declaration behind them, and the contract's whole claim
 * is that a package's models arrive because it said so. Declaring changes no
 * host behaviour (the assembler reads the declaration where it used to scan)
 * and closes the one case where composition was happening by accident.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifest is a plain `satisfies`-checked value, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from '@12-apps/wiring';

export const notificationsManifest = {
  name: '@12-apps/notifications',
  contract: 1,
  db: { partial: 'prisma/notifications.prisma', migrations: 'prisma/migrations' },
  /**
   * Mandatory for runtime manifests since wiring 1.3.0: a delivery that
   * exhausts its attempts files under `notifications`, not nowhere.
   */
  observability: { namespace: 'notifications' },
  server: ['http'],
} as const satisfies PackageManifest;
