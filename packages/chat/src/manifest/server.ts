/**
 * `@12-apps/chat/manifest/server` — `http.create` IS `createApiChat`. A host
 * that mounts one route set per audience calls the factory once per audience
 * with its own `authorize`, binding the manifest for whichever it adopts.
 */

import type { AnyServerManifest } from "@12-apps/wiring";

import { createApiChat } from "../server/index";

export const chatServerManifest = {
  name: "@12-apps/chat",
  http: { create: createApiChat },
} as const satisfies AnyServerManifest;
