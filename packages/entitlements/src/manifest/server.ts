/**
 * `@12-apps/entitlements/manifest/server` — the server capabilities.
 *
 * `http.create` IS `createApiEntitlements` (`../server`), unchanged: the plan
 * read and the plan-change request over the host's service, lead store and
 * REQUIRED copy. `EntitlementsRequest` carries only `{ actor, body }` — this
 * surface resolves the tenant server-side and reads no path or query param —
 * so the descriptors satisfy the contract's wider `WireRequest` structurally,
 * with no wire view.
 */

import type { AnyServerManifest } from '@12-apps/wiring';

import { createApiEntitlements } from '../server';

export const entitlementsServerManifest = {
  name: '@12-apps/entitlements',
  http: { create: createApiEntitlements },
} as const satisfies AnyServerManifest;
