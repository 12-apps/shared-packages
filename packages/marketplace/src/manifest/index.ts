/**
 * `@12-apps/marketplace/manifest` — the SHARED wiring manifest.
 *
 * The owner's second rule, "this base engine must be a separate lib that
 * implements the wiring package", is this file and `./server`:
 *
 * - `permissions` — `marketplace:manage` (connect, map) and
 *   `marketplace:decide` (answer the queue). The host decides which roles
 *   hold them.
 * - `mcp` — the seven marketplace tools, their schemas the routes' own
 *   validators. The decision tool carries the marketplace's reason code on the
 *   SAME tool, all-or-nothing.
 * - `db` — `composed`: the partial names no host table (by-value scalars, the
 *   discounts doctrine), and its migration adopts a predecessor's tables
 *   replay-safely. Composed rather than isolated because a host creates its
 *   own order in the same unit of work that ingests one.
 * - `observability` — failures file under `marketplace`.
 * - `server` — `http` (the webhook and the seven routes) and `jobs` (the two
 *   sweeps and the outbound call).
 *
 * No `web`: the screens that draw the queue and the refusal dialog are the
 * host's. No `notifications`: an arriving order is the host's news to tell.
 *
 * `@12-apps/wiring` is a TYPE-ONLY dependency here: the manifest is a plain
 * `satisfies`-checked value, and the producer's assertions run in this
 * package's own test suite.
 */

import type { PackageManifest } from "@12-apps/wiring";

import { MARKETPLACE_PERMISSIONS } from "../server/contribution";
import { MARKETPLACE_MCP_TOOLS } from "../server/mcp";

export const marketplaceManifest = {
  name: "@12-apps/marketplace",
  contract: 1,
  permissions: MARKETPLACE_PERMISSIONS,
  mcp: { endpoints: MARKETPLACE_MCP_TOOLS },
  db: { partial: "prisma/marketplace.prisma", migrations: "prisma/migrations" },
  observability: { namespace: "marketplace" },
  server: ["http", "jobs"],
} as const satisfies PackageManifest;
