/**
 * `@12-apps/chat/manifest/native` — `surface.create` IS `createNativeChat`,
 * behind its own subpath so a native bundle never resolves the web surface.
 */

import type { AnyNativeManifest } from "@12-apps/wiring";

import { createNativeChat } from "../native/index";

export const chatNativeManifest = {
  name: "@12-apps/chat",
  surface: { create: createNativeChat },
} as const satisfies AnyNativeManifest;
