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
 *
 * ON THE `jobs` DECLARATION. The dispatch fast path and the retry sweep are
 * this package's own cadence decisions — attempts, backoff, the five-minute
 * tick, the single-flight lease — and they were host code in every adopting
 * host, restated by hand from this package's docstrings. That is the
 * `paymentsJobBlueprints()` incident's shape exactly: a mechanism a host must
 * remember to schedule is a mechanism most hosts silently do not have, and the
 * one host that DID write them wrote them correctly only because someone read
 * the source. `./server`'s `NOTIFICATIONS_JOBS` declares both; a host with no
 * worker declines the capability in writing and the report says so.
 *
 * ON THE `web` INVENTORY, which this manifest used to narrow away. The reason
 * given — that listing it would oblige every SERVER host to answer for a React
 * surface it never mounts — is not how the consumer behaves: a capability
 * declared for the OTHER runtime is reported `out-of-scope`, and only an
 * applicable, unanswered one is `unbound`. So the narrowing protected nothing
 * and hid Bell, Panel and Preferences from every adopting host, which is why
 * the origin host hand-duplicated two of the three.
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
  server: ['http', 'jobs'],
  web: ['surface'],
} as const satisfies PackageManifest;
