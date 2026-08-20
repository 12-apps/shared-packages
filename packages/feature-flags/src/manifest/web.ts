/**
 * `@12-apps/feature-flags/manifest/web` — the web capabilities.
 *
 * `surface.create` IS `createWebFeatureFlags`, unchanged; the consumer's
 * binder builds it once per adoption (members are component TYPES).
 *
 * The area suggestion targets `super-admin` — this surface manages who is in
 * a beta, which is platform authority, never a tenant screen. Deliberately
 * bare: one route, one nav anchor, no permission and no plan-feature gates
 * (platform authority is host vocabulary — in the origin host an env
 * allowlist that no permission id can express). The host owns placement and
 * every word.
 */

import type { AnyWebManifest } from "@12-apps/wiring";

import { createWebFeatureFlags } from "../react/create-feature-flags";

export const featureFlagsWebManifest = {
  name: "@12-apps/feature-flags",
  surface: { create: createWebFeatureFlags },
  areas: [
    {
      area: "super-admin",
      routes: [{ path: "feature-flags", screen: "page" }],
      nav: [{ testId: "feature-flags", path: "feature-flags" }],
    },
  ],
} as const satisfies AnyWebManifest;
