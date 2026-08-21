/**
 * `@12-apps/realtime/manifest/web` — the web capability.
 *
 * `surface.create` IS `createWebEvents`, unchanged: the browser half's one
 * factory (provider, topic hooks, the poll-relaxing helpers). The consumer's
 * binder builds it once per adoption — the memoisation rule — and the
 * package's own contract holds regardless of transport: keep your poll;
 * events carry no state. No `areas`: this package ships plumbing, not
 * screens — there is no route or nav row to suggest.
 */

import type { AnyWebManifest } from "@12-apps/wiring";

import { createWebEvents } from "../react";

export const realtimeWebManifest = {
  name: "@12-apps/realtime",
  surface: { create: createWebEvents },
} as const satisfies AnyWebManifest;
