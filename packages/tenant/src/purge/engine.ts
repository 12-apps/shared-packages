/**
 * `createTenantPurge`: the purge engine over a tenant that has the lifecycle.
 * It reuses the tenant's `setStatusIf`, `byId`, `port.clearProfile`, tree and
 * `ids.audit.closePurged`, and the lifecycle's `db.table`, `audit`,
 * `invalidate`, `onError` and `sweepBatch`; the purge's own config adds the
 * tables, the raw statements, the host callbacks and storage. Every piece is
 * validated before it returns (`TenantConfigError`, the key named).
 *
 * Wire it into the lifecycle with `lifecycle.purge` (in place of
 * `onPurgeDue`): the sweep then runs `run` for each due tenant, stamps
 * nothing itself (the engine stamps `purged_at`), and runs the image pass.
 */
import type { TenantStatusSet } from '../config';
import type { LifecycleTenant } from '../lifecycle/context';
import type { TenantLifecycleConfig } from '../lifecycle/types';
import type { TenantPort } from '../port';
import { TenantConfigError } from '../validate';
import { eraseOwedImages, sweepImages } from './images';
import { compilePlan, type CompiledPlan } from './plan';
import { runPurge } from './run';
import type { TenantPurge, TenantPurgeConfig } from './types';
import { validatePurge, validatePurgeLifecycle } from './validate';

/** The slice of `ApiTenant` the purge reads. */
export interface PurgeTenant<S extends string, Tx> extends LifecycleTenant<S, Tx> {
  port: Pick<TenantPort<S, Tx>, 'clearProfile'>;
}

/** What every step of the engine shares. */
export interface PurgeEngine<S extends string, Tx> {
  tenant: PurgeTenant<S, Tx>;
  lifecycle: TenantLifecycleConfig<S, Tx>;
  config: TenantPurgeConfig<Tx>;
  statuses: TenantStatusSet<S>;
  plan: CompiledPlan;
  /** The package's closing table, quoted, as `models.resolve` maps `TenantClosing`. */
  closings: string;
}

export function createTenantPurge<S extends string, Tx>(
  tenant: PurgeTenant<S, Tx>,
  lifecycle: TenantLifecycleConfig<S, Tx>,
  config: TenantPurgeConfig<Tx>,
): TenantPurge {
  validatePurgeLifecycle(lifecycle);
  if (typeof (tenant as { port?: { clearProfile?: unknown } }).port?.clearProfile !== 'function') {
    throw new TenantConfigError('port.clearProfile', 'must be a function');
  }
  const { closings } = validatePurge(config);
  const engine: PurgeEngine<S, Tx> = {
    tenant,
    lifecycle,
    config,
    statuses: tenant.config.statuses as unknown as TenantStatusSet<S>,
    plan: compilePlan(config),
    closings: `"${closings.replace(/"/gu, '""')}"`,
  };
  return {
    run: (tenantId, at) => runPurge(engine, tenantId, at),
    eraseOwedImages: (tenantId, at) => eraseOwedImages(engine, tenantId, at),
    sweepImages: (now) => sweepImages(engine, now),
    plan: () => engine.plan.steps,
  };
}
