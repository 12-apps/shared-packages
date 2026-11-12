/**
 * `@12-apps/marketplace/manifest/server` — the server capabilities.
 *
 * `http.create` IS `createApiMarketplace`, unchanged: its descriptors already
 * satisfy the wiring contract's `WireRoute`, policy half included, so a host's
 * gates read each route's permission off the assembled table. `jobs` is the
 * engine's own cadence (`../server/jobs`); a host binds `{ engine }` and
 * deletes its hand-rolled sweeps.
 */

import type { AnyServerManifest } from "@12-apps/wiring";

import { createApiMarketplace } from "../server";
import { MARKETPLACE_JOBS } from "../server/jobs";

export const marketplaceServerManifest = {
  name: "@12-apps/marketplace",
  http: { create: createApiMarketplace },
  jobs: MARKETPLACE_JOBS,
} as const satisfies AnyServerManifest;
