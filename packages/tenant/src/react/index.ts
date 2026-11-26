/**
 * `@12-apps/tenant/react` — the frontend factory.
 *
 * `createWebTenant` takes the half of the config a browser needs (the status
 * set, the ids, the copy packs) and validates it at startup exactly as the
 * backend does. The tenant port is the server's and never reaches a browser.
 * This slice ships the readings a screen needs (which pack to show, which
 * refusal an answer is); the screens arrive with the lifecycle slice.
 */
import type { TenantCoreConfig } from '../config';
import { createReadings, frozenCopy, type DeepReadonly, type TenantReadings } from '../core';
import { validateCoreConfig } from '../validate';

export { TenantConfigError } from '../validate';

/** Everything `createWebTenant` needs. Nothing is optional. */
export type TenantWebConfig<S extends string = string> = TenantCoreConfig<S>;

export interface WebTenant<S extends string = string> extends TenantReadings<S> {
  /** The validated config, a deep-frozen copy. */
  config: DeepReadonly<TenantWebConfig<S>>;
}

export function createWebTenant<S extends string>(config: TenantWebConfig<S>): WebTenant<S> {
  validateCoreConfig(config);
  const data = frozenCopy({ statuses: config.statuses, ids: config.ids, copy: config.copy });
  return { ...createReadings(data), config: data };
}
