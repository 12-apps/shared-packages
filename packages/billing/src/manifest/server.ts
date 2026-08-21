/**
 * `@12-apps/billing/manifest/server` — the server capabilities.
 *
 * One contribution: `http`, whose `create` IS `createApiBilling`, unchanged.
 * Behind its own subpath so a web bundle importing the shared manifest never
 * resolves the server half — and with it `@12-apps/payments-backend`. A plain
 * `satisfies`-checked value; see `./index` for why the contract package stays
 * a type-only devDependency, and the test suite for the inventory check
 * against the shared manifest.
 */

import type { AnyServerManifest } from "@12-apps/wiring";

import { createApiBilling } from "../server/routes";

export const billingServerManifest = {
  name: "@12-apps/billing",
  http: { create: createApiBilling },
} as const satisfies AnyServerManifest;
