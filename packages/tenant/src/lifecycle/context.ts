/**
 * What every lifecycle step shares: the tenant's readings, the validated
 * config, and the small helpers that keep each step's rules in one place.
 */
import type { TenantCopyPack, TenantCoreConfig } from '../config';
import type { DeepReadonly } from '../core';
import type { TenantRecord } from '../port';
import type { TenantTree } from '../tree';
import { TenantConfigError } from '../validate';
import { TENANT_REFUSAL_STATUS, TenantLifecycleRefusal, refusalSentence, type TenantLifecycleRefusalKind } from './refusal';
import type { TenantBlocker, TenantClosingEvent, TenantClosingStamp, TenantClosingTable, TenantLifecycleConfig } from './types';

/** The slice of `ApiTenant` the lifecycle reads. */
export interface LifecycleTenant<S extends string, Tx> {
  config: DeepReadonly<TenantCoreConfig<S>>;
  copyFor(locale: string | null | undefined): TenantCopyPack;
  byId(id: string, tx?: Tx): Promise<TenantRecord<S> | null>;
  setStatusIf(id: string, from: S, to: S, tx: Tx): Promise<boolean>;
  tree?: TenantTree<Tx>;
}

export interface LifecycleContext<S extends string, Tx> {
  tenant: LifecycleTenant<S, Tx>;
  config: TenantLifecycleConfig<S, Tx>;
  /** The table on `tx`, or on the client. */
  table(tx?: Tx): Promise<TenantClosingTable>;
  /** A refusal of `kind`, in the current request's words. */
  refuse(kind: TenantLifecycleRefusalKind, details?: Readonly<Record<string, number>>, count?: number): TenantLifecycleRefusal;
  /** Run `step`; a throw goes to `onError` and never past it. */
  quietly(act: string, tenantId: string, step: () => Promise<unknown>): Promise<void>;
  /** Stamp `field` where still null, with the mirror's event, in one transaction. Answers the rows stamped. */
  stamp(tenantId: string, field: TenantClosingStamp, at: Date, event: TenantClosingEvent): Promise<number>;
  /** The record's name: a lifecycle host's port must return it. */
  nameOf(record: TenantRecord<S>): string;
  /** Whether `status` is closing or closed. */
  isGone(status: string): boolean;
  /** The tenant's open blockers, counted on `tx` when given. */
  blockersOf(tenantId: string, now: Date, tx?: Tx): Promise<TenantBlocker[]>;
}

/** The tree's blocker: descendants other than the tenant that are neither closing nor closed. */
async function openDescendants<S extends string, Tx>(
  context: Pick<LifecycleContext<S, Tx>, 'tenant' | 'isGone'>,
  tenantId: string,
  tx: Tx | undefined,
): Promise<number> {
  const { tree } = context.tenant;
  if (tree === undefined) return 0;
  const below = await tree.descendantsOf(tenantId, tx);
  let open = 0;
  for (const node of below) {
    const record = await context.tenant.byId(node.id, tx);
    if (record !== null && !context.isGone(record.status)) open += 1;
  }
  return open;
}

export function createContext<S extends string, Tx>(
  tenant: LifecycleTenant<S, Tx>,
  config: TenantLifecycleConfig<S, Tx>,
): LifecycleContext<S, Tx> {
  const { statuses, ids } = tenant.config;
  const paths = new Map(config.blockers.kinds.map((entry) => [entry.kind, entry.path]));
  const table = async (tx?: Tx) => config.db.table(tx);
  const context: LifecycleContext<S, Tx> = {
    tenant,
    config,
    table,
    refuse: (kind, details = {}, count = 0) =>
      new TenantLifecycleRefusal(
        {
          kind,
          status: TENANT_REFUSAL_STATUS[kind],
          code: ids.refusals[kind],
          message: refusalSentence(tenant.copyFor(config.locale()), kind, count),
        },
        details,
      ),
    quietly: async (act, tenantId, step) => {
      try {
        await step();
      } catch (error) {
        config.onError(error, { act, tenantId });
      }
    },
    stamp: (tenantId, field, at, event) =>
      config.db.transaction(async (tx) => {
        const { count } = await (await table(tx)).updateMany({
          where: { tenantId, [field]: null },
          data: { [field]: at },
        });
        if (count > 0 && config.mirror !== undefined) await config.mirror.event(tx, tenantId, event);
        return count;
      }),
    nameOf: (record) => {
      if (typeof record.name !== 'string') {
        throw new TenantConfigError('port.byId', `returned tenant "${record.id}" with no name, which the lifecycle needs`);
      }
      return record.name;
    },
    isGone: (status) => status === statuses.closing || status === statuses.closed,
    blockersOf: async (tenantId, now, tx) => {
      const counts = await config.blockers.read(tenantId, tx === undefined ? { now } : { now, tx });
      const found: TenantBlocker[] = counts
        .filter((entry) => entry.count > 0)
        .map((entry) => {
          const path = paths.get(entry.kind);
          if (path === undefined) {
            throw new TenantConfigError('lifecycle.blockers.kinds', `does not list "${entry.kind}", which blockers.read answered`);
          }
          return { ...entry, path };
        });
      const open = await openDescendants(context, tenantId, tx);
      if (open > 0 && config.openDescendants !== undefined) {
        found.push({ kind: config.openDescendants.kind, count: open, path: config.openDescendants.path });
      }
      return found;
    },
  };
  return context;
}
