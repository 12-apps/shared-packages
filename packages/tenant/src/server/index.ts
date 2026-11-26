/**
 * `@12-apps/tenant/server` — the backend factory.
 *
 * `createApiTenant` takes the WHOLE config: the status set, the ids, the copy
 * packs and the tenant port, every one required. It validates them before it
 * returns, so a host missing a piece fails when it boots, with the missing key
 * named (`TenantConfigError`), instead of adopting somebody else's values.
 *
 * Framework-neutral, the report-builder doctrine: routes are plain
 * descriptors and `@12-apps/tenant/hono` mounts them. This slice ships the
 * shape, the validation and the readings; the lifecycle, the purge and the
 * export add their routes and behaviour on top of the same config.
 */
import type { TenantCoreConfig } from '../config';
import { createReadings, type TenantReadings } from '../core';
import type { TenantPort } from '../port';
import { createTenantTree, type TenantTree } from '../tree';
import { validateCoreConfig, validatePort } from '../validate';

export { TenantConfigError } from '../validate';

/** A framework-neutral route: the Hono adapter mounts each one as given. */
export interface TenantRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Relative to wherever the host mounts the package. */
  path: string;
  handler(request: Request): Promise<Response>;
}

/** Everything `createApiTenant` needs. Nothing is optional. */
export interface TenantServerConfig<S extends string = string, Tx = unknown>
  extends TenantCoreConfig<S> {
  /** The host's tenant row, reached only through this port. */
  port: TenantPort<S, Tx>;
}

export interface ApiTenant<S extends string = string, Tx = unknown> extends TenantReadings<S> {
  /** The validated config, frozen. */
  config: Readonly<TenantServerConfig<S, Tx>>;
  /** The host's tenant port, as given. */
  port: TenantPort<S, Tx>;
  /** The tenant tree, read and moved through the port's tree methods. */
  tree: TenantTree<Tx>;
  /** The package's routes, in mount order. None yet: the lifecycle slice adds them. */
  routes: readonly TenantRoute[];
}

export function createApiTenant<S extends string, Tx = unknown>(
  config: TenantServerConfig<S, Tx>,
): ApiTenant<S, Tx> {
  validateCoreConfig(config);
  validatePort((config as { port?: unknown }).port);
  const frozen = Object.freeze({ ...config });
  return {
    ...createReadings(frozen),
    config: frozen,
    port: frozen.port,
    tree: createTenantTree(frozen.port),
    routes: Object.freeze([]),
  };
}
