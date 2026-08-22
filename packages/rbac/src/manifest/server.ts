/**
 * `@12-apps/rbac/manifest/server` — the server capabilities.
 *
 * `http.create` IS `createApiRbac` (`../server`), unchanged: the whole admin
 * surface — roles, templates, the team roster, grant governance — over the
 * host's catalog, db seam, directory port and REQUIRED messages. `RbacRequest`
 * is `WireRequest` minus the raw `request` these handlers never read, so the
 * descriptors satisfy the contract structurally, with no wire view.
 *
 * The factory's generic (`P extends string`, the host's permission union)
 * survives the binding: the contract's widest server manifest types `create`
 * at `never`, and method bivariance is what lets a generic factory satisfy
 * it without erasing the union a host actually binds with.
 *
 * What rides BESIDE the routes on the assembled aggregate — `guards`,
 * `engine`, `governance`, the two stores and `seedTenantRoles` — is the rest
 * of `ApiRbac`, and a host still reaches for it directly: this surface is
 * the one every OTHER host surface asks permission from, so the capability
 * being mounted does not make the guards stop being a library.
 */

import type { AnyServerManifest } from '@12-apps/wiring';

import { createApiRbac } from '../server';

export const rbacServerManifest = {
  name: '@12-apps/rbac',
  http: { create: createApiRbac },
} as const satisfies AnyServerManifest;
