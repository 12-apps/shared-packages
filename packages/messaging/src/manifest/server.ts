/**
 * `@12-apps/messaging/manifest/server` — the server capabilities.
 *
 * `http.create` IS `createApiMessaging`: its descriptors already satisfy the
 * wiring contract's `WireRoute`, both marked `webhook`. `jobs` is the
 * connector's own cadence; a host binds `{ engine }`.
 */

import type { AnyServerManifest } from "@12-apps/wiring";

import { createApiMessaging } from "../server";
import { MESSAGING_JOBS } from "../server/jobs";

export const messagingServerManifest = {
  name: "@12-apps/messaging",
  http: { create: createApiMessaging },
  jobs: MESSAGING_JOBS,
} as const satisfies AnyServerManifest;
