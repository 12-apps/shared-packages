/**
 * `@12-apps/feature-flags/manifest/server` — the server capabilities.
 *
 * One contribution: `http`, whose `create` IS `createApiFeatureFlags`,
 * unchanged. Behind its own subpath so a web bundle importing
 * `./manifest/web` never resolves the server half. A plain
 * `satisfies`-checked value — see `./index` for why the contract package
 * stays a type-only devDependency; the inventory check against the shared
 * manifest runs in the test suite.
 */

import type { AnyServerManifest } from "@12-apps/wiring";

import { createApiFeatureFlags } from "../server/index";

export const featureFlagsServerManifest = {
  name: "@12-apps/feature-flags",
  http: { create: createApiFeatureFlags },
} as const satisfies AnyServerManifest;
