/**
 * `@12-apps/routing/manifest/server` — `http.create` IS `createApiRouting`.
 * A host that only plans in-process still binds it (the routes are inert until
 * mounted) or declines the capability with its reason.
 */

import type { AnyServerManifest } from "@12-apps/wiring";

import { createApiRouting } from "../server/index";

export const routingServerManifest = {
  name: "@12-apps/routing",
  http: { create: createApiRouting },
} as const satisfies AnyServerManifest;
