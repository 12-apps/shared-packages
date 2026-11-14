/**
 * `@12-apps/messaging/manifest` — the SHARED wiring manifest.
 *
 * - `db` — `composed`: the partial names no host table (tenant and staff ids
 *   are by-value strings), so it composes into any host's schema folder.
 *   Composed rather than isolated because a host keeps its own links (a cart,
 *   a customer, a sale) keyed by the conversation id, in the same database.
 * - `observability` — failures file under `messaging`.
 * - `server` — `http` (the webhook pair) and `jobs` (process, reconcile,
 *   retention).
 *
 * Declined, each with its argument in `.wiring-conformance.json`:
 * `permissions` (no authenticated route ships yet), `notifications` (an
 * arriving message is the host's news, through `onInboundMessage`), `mcp`
 * (conversations and contacts' addresses are off the agent surface by
 * design), `email`, the environment (every secret arrives as config), `e2e`,
 * and the web capabilities (the screens are the host's).
 *
 * `@12-apps/wiring` is a TYPE-ONLY dependency here: the manifest is a plain
 * `satisfies`-checked value, and the producer's assertions run in this
 * package's own test suite.
 */

import type { PackageManifest } from "@12-apps/wiring";

export const messagingManifest = {
  name: "@12-apps/messaging",
  contract: 1,
  db: { partial: "prisma/messaging.prisma", migrations: "prisma/migrations" },
  observability: { namespace: "messaging" },
  server: ["http", "jobs"],
} as const satisfies PackageManifest;
