/**
 * `@12-apps/chat/manifest/web` — `surface.create` IS `createWebChat`. No
 * `areas`: a thread is not a page of its own, it sits inside whatever screen
 * shows the thing it is about, which only the host knows.
 */

import type { AnyWebManifest } from "@12-apps/wiring";

import { createWebChat } from "../react/index";

export const chatWebManifest = {
  name: "@12-apps/chat",
  surface: { create: createWebChat },
} as const satisfies AnyWebManifest;
