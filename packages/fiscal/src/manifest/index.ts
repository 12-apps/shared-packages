/**
 * `@12-apps/fiscal/manifest` — the SHARED wiring manifest.
 *
 * - `permissions` — `fiscal:read`, `fiscal:manage`, `fiscal:issue`,
 *   `fiscal:cancel`, declared here and nowhere else; every route in
 *   `../http` names the one it needs.
 * - `db` — the Prisma partial (`prisma/fiscal.prisma`: the emitter profile,
 *   issuing points, one number counter per series, documents and their
 *   events) and its migrations.
 * - `observability` — `fiscal`: the sweeps log under it.
 * - `server: ["http", "jobs"]` — `./manifest/server`.
 *
 * Narrowings, each argued in `.wiring-conformance.json`:
 *
 * - **No static `notifications`.** The two alerts (certificate expiring,
 *   document rejected) are host words, so they ship as the factory
 *   `createFiscalNotificationBlueprints(copy)` (`@12-apps/fiscal/notifications`),
 *   which the host feeds to its own mount.
 * - **No `web` surface yet.** The fiscal settings screen and the documents
 *   list are built with their screen tickets (FUT-2231, FUT-2238) from the
 *   owner's approved prototypes, over these routes.
 * - **No NFS-e.** Only the platform's own NFS-e is planned (FUT-2242).
 *
 * `@12-apps/wiring` is a TYPE-ONLY dependency: the manifest is a plain
 * `satisfies`-checked value, and the producer's assertions run in this
 * package's own test suite.
 */

import type { PackageManifest } from "@12-apps/wiring";

import { FISCAL_PERMISSIONS } from "./permissions";

export { FISCAL_CANCEL, FISCAL_ISSUE, FISCAL_MANAGE, FISCAL_PERMISSIONS, FISCAL_READ } from "./permissions";

export const fiscalManifest = {
  name: "@12-apps/fiscal",
  contract: 1,
  permissions: FISCAL_PERMISSIONS,
  db: { partial: "prisma/fiscal.prisma", migrations: "prisma/migrations" },
  observability: { namespace: "fiscal" },
  server: ["http", "jobs"],
} as const satisfies PackageManifest;
