/**
 * `@12-apps/feature-flags/manifest` — the SHARED wiring manifest.
 *
 * Identity, the Prisma contribution and the runtime inventory. Two absences
 * are deliberate, not omissions:
 *
 * - **No `mcp` contribution.** The management surface is browser-only by the
 *   same policy that keeps the origin host's whole platform prefix off the
 *   agent surface: a superadmin bearer already inherits cross-tenant reach
 *   over the shared tools, so cross-tenant platform writes stay in the
 *   browser. A host that ever wants agent control gets tools as an ADDITIVE
 *   release, not a default.
 * - **No `permissions` contribution.** Platform authority in the origin host
 *   is an env allowlist, outside any RBAC catalog. A tenant-scoped host that
 *   wants an RBAC-gated flags surface contributes its own permission and
 *   guards the mount itself.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifests are plain `satisfies`-checked values, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from "@12-apps/wiring";

export const featureFlagsManifest = {
  name: "@12-apps/feature-flags",
  contract: 1,
  db: { partial: "prisma/feature-flags.prisma", migrations: "prisma/migrations" },
  /**
   * Mandatory for runtime manifests since wiring 1.3.0: the binder hands
   * this package a logger scoped to the namespace, so a grant check that
   * fails files under `feature-flags`, not nowhere.
   */
  observability: { namespace: "feature-flags" },
  server: ["http"],
  web: ["surface", "areas"],
} as const satisfies PackageManifest;
