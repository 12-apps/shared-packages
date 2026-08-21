/**
 * `@12-apps/entity-lifecycle/manifest/server` — the server capability.
 *
 * `http.create` IS `createApiEntityLifecycle`, unchanged: the host hands it
 * its db seam, its entity REGISTRATIONS (the kinds, their slugs, features,
 * ops and host-vocabulary permission ids) and gets back the route
 * descriptors — six shared routes plus eight per registration, paths built
 * from the host's own slugs. The route list is therefore DYNAMIC (`6 + 8n`),
 * which is exactly why this manifest declares the factory rather than a
 * table: the consumer's `unclaimedRoutes` accounting runs over whatever the
 * host's registrations produce.
 *
 * A plain `satisfies`-checked value — see `./index` for why the contract
 * package stays a type-only devDependency.
 */

import type { AnyServerManifest } from '@12-apps/wiring';

import { createApiEntityLifecycle } from '../server/create-api-entity-lifecycle';

export const entityLifecycleServerManifest = {
  name: '@12-apps/entity-lifecycle',
  http: { create: createApiEntityLifecycle },
} as const satisfies AnyServerManifest;
