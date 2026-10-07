/**
 * `@12-apps/routing/manifest/web` — `surface.create` IS `createWebRouting`.
 * No `areas`: a route map is not a page of its own, it sits inside whatever
 * screen shows the trip, which only the host knows.
 */

import type { AnyWebManifest } from "@12-apps/wiring";

import { createWebRouting } from "../react/index";

export const routingWebManifest = {
  name: "@12-apps/routing",
  surface: { create: createWebRouting },
} as const satisfies AnyWebManifest;
