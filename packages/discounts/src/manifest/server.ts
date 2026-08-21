/**
 * `@12-apps/discounts/manifest/server` — the server capabilities.
 *
 * One contribution: `http`, whose `create` IS {@link createApiDiscounts},
 * unchanged. The descriptors it returns already satisfy the wiring contract's
 * `WireRoute` — including the POLICY half, so a host's coverage gates can read
 * each route's required permission off the assembled table instead of
 * scanning route files for a guard literal.
 *
 * Behind its own subpath so a web bundle importing the shared manifest never
 * resolves the server half. A plain `satisfies`-checked value — see `./index`
 * for why the contract package stays a type-only devDependency; the inventory
 * check against the shared manifest runs in the test suite.
 */

import type { AnyServerManifest } from "@12-apps/wiring";

import { createApiDiscounts } from "../server/routes";

export const discountsServerManifest = {
  name: "@12-apps/discounts",
  http: { create: createApiDiscounts },
} as const satisfies AnyServerManifest;
