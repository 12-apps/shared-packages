/**
 * `@12-apps/routing/manifest` — the SHARED wiring manifest.
 *
 * Identity and the runtime inventory: one HTTP route set (and the in-process
 * planner beside it) for a server host, the map surface for a web host.
 * `@12-apps/wiring` is a TYPE-ONLY devDependency; the producer assertions run
 * in this package's own suite.
 */

import type { PackageManifest } from "@12-apps/wiring";

export const routingManifest = {
  name: "@12-apps/routing",
  contract: 1,
  observability: { namespace: "routing" },
  server: ["http"],
  web: ["surface"],
} as const satisfies PackageManifest;
