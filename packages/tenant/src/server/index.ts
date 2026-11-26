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
 * shape, the validation, the readings and the transaction-bound status move;
 * the lifecycle, the purge and the export add their routes and behaviour on
 * top of the same config.
 */
import type { TenantCoreConfig } from '../config';
import { createReadings, frozenCopy, type DeepReadonly, type TenantReadings } from '../core';
import type { TenantPort, TenantRecord } from '../port';
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
  /** The validated config's data parts (statuses, ids, copy), deep-frozen copies. */
  config: DeepReadonly<TenantCoreConfig<S>>;
  /** The host's tenant port, as given. */
  port: TenantPort<S, Tx>;
  /** The package's routes, in mount order. None yet: the lifecycle slice adds them. */
  routes: readonly TenantRoute[];
  /** The tenant, read through the port, on `tx` when given. */
  byId(id: string, tx?: Tx): Promise<TenantRecord<S> | null>;
  /**
   * Move the tenant's status from `from` to `to` on the CALLER's transaction:
   * true when it moved. Both must be statuses of the host's set; the port's
   * compare-and-set runs on `tx`, so a later refusal in the same transaction
   * rolls the move back.
   */
  setStatusIf(id: string, from: S, to: S, tx: Tx): Promise<boolean>;
}

export function createApiTenant<S extends string, Tx = unknown>(
  config: TenantServerConfig<S, Tx>,
): ApiTenant<S, Tx> {
  validateCoreConfig(config);
  validatePort((config as { port?: unknown }).port);
  const data = frozenCopy({ statuses: config.statuses, ids: config.ids, copy: config.copy });
  const known = new Set<string>(data.statuses.all);
  const { port } = config;
  return {
    ...createReadings(data),
    config: data,
    port,
    routes: Object.freeze([]),
    byId: (id, tx) => port.byId(id, tx),
    setStatusIf: (id, from, to, tx) => {
      for (const [key, status] of [['from', from], ['to', to]] as const) {
        if (!known.has(status)) {
          return Promise.reject(
            new RangeError(`@12-apps/tenant: setStatusIf "${key}" is "${status}", which statuses.all does not list.`),
          );
        }
      }
      return port.setStatusIf(id, from, to, tx);
    },
  };
}
