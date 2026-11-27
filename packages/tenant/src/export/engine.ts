/**
 * `createTenantExport`: the data export engine over a tenant that has the
 * lifecycle. It reuses the tenant's `byId`, `port.timeZone`, copy packs and
 * ids (`ids.audit.export*`, `ids.notifications.exportReady`,
 * `ids.permissions.close`, `ids.refusals.export*` and `closed`), and the
 * lifecycle's closing table (a link never outlives the purge date),
 * `locale` and `onError`. The export's own config adds the sections, the
 * archive port, the limits, its copy and the host's hooks. Every piece is
 * validated before it returns (`TenantConfigError`, the key named).
 *
 * The host registers `build` and `sweep` on its own job queue, mounts
 * `request` and `download` on its routes, and adds `beforeErase` to the purge
 * engine's `beforeErase` list.
 *
 * An export covers ONE tenant, the node it is asked for: the engine never
 * reads the tree, and a consolidated export over a network is not its job.
 */
import type { TenantStatusSet } from '../config';
import type { DeepReadonly } from '../core';
import type { LifecycleTenant } from '../lifecycle/context';
import type { TenantLifecycleConfig } from '../lifecycle/types';
import type { TenantPort } from '../port';
import { TenantConfigError } from '../validate';
import { buildExport } from './build';
import { eraseExports } from './erase';
import { archiveFilename, downloadExport, expiryOf, requestExport } from './requests';
import { sweepExports } from './sweep';
import { noticeWords } from './tell';
import type {
  TenantDataExportTable,
  TenantDataExportUpdate,
  TenantDataExportWhere,
  TenantExport,
  TenantExportConfig,
} from './types';
import { validateExport, validateExportLifecycle } from './validate';

/** The slice of `ApiTenant` the export reads. */
export interface ExportTenant<S extends string, Tx> extends LifecycleTenant<S, Tx> {
  port: Pick<TenantPort<S, Tx>, 'timeZone'>;
}

/** The export's refusal kinds: the base config's refusal codes it answers. */
export type TenantExportRefusalKind = 'exportNeedsPerson' | 'exportNotFound' | 'exportExpired' | 'closed';

/** Each kind's HTTP status: never the host's choice, so every host's clients read the same. */
export const TENANT_EXPORT_REFUSAL_STATUS: Readonly<Record<TenantExportRefusalKind, 403 | 404 | 410>> = {
  exportNeedsPerson: 403,
  exportNotFound: 404,
  exportExpired: 410,
  closed: 403,
};

/** Thrown by `request` and `download`: the host maps it onto its own error envelope. */
export class TenantExportRefusal extends Error {
  readonly kind: TenantExportRefusalKind;
  readonly code: string;
  readonly status: 403 | 404 | 410;

  constructor(kind: TenantExportRefusalKind, code: string, message: string) {
    super(message);
    this.name = 'TenantExportRefusal';
    this.kind = kind;
    this.code = code;
    this.status = TENANT_EXPORT_REFUSAL_STATUS[kind];
  }
}

/** What every step of the engine shares. */
export interface ExportEngine<S extends string, Tx> {
  tenant: ExportTenant<S, Tx>;
  lifecycle: TenantLifecycleConfig<S, Tx>;
  config: TenantExportConfig<Tx>;
  statuses: DeepReadonly<TenantStatusSet<S>>;
  /** The table on `tx`, or on the client. */
  table(tx?: Tx): Promise<TenantDataExportTable>;
  /** One conditional write, with the mirror, in one transaction. Answers the rows moved. */
  write(id: string, where: Omit<TenantDataExportWhere, 'id'>, data: TenantDataExportUpdate): Promise<number>;
  /** A refusal of `kind`, in the current request's words. */
  refuse(kind: TenantExportRefusalKind): TenantExportRefusal;
  /** The purge date of the tenant's closing row, or null when it has none. */
  purgeAtOf(tenantId: string): Promise<Date | null>;
}

const SENTENCE = {
  exportNeedsPerson: 'refusalExportNeedsPerson',
  exportNotFound: 'refusalExportNotFound',
  exportExpired: 'refusalExportExpired',
  closed: 'refusalClosed',
} as const;

export function createTenantExport<S extends string, Tx>(
  tenant: ExportTenant<S, Tx>,
  lifecycle: TenantLifecycleConfig<S, Tx>,
  config: TenantExportConfig<Tx>,
): TenantExport {
  validateExportLifecycle(lifecycle);
  if (typeof (tenant as { port?: { timeZone?: unknown } }).port?.timeZone !== 'function') {
    throw new TenantConfigError('port.timeZone', 'must be a function');
  }
  validateExport(config, Object.keys(tenant.config.copy.locales));
  const table = async (tx?: Tx) => config.db.table(tx);
  const engine: ExportEngine<S, Tx> = {
    tenant,
    lifecycle,
    config,
    statuses: tenant.config.statuses,
    table,
    write: (id, where, data) =>
      config.db.transaction(async (tx) => {
        const { count } = await (await table(tx)).updateMany({ where: { id, ...where }, data });
        if (count > 0 && config.mirror !== undefined) await config.mirror.updated(tx, id, data);
        return count;
      }),
    refuse: (kind) =>
      new TenantExportRefusal(kind, tenant.config.ids.refusals[kind], tenant.copyFor(lifecycle.locale())[SENTENCE[kind]]),
    purgeAtOf: async (tenantId) => {
      const row = await (await lifecycle.db.table()).findUnique({ where: { tenantId } });
      return row?.purgeAt ?? null;
    },
  };
  return {
    request: (input) => requestExport(engine, input),
    download: (input) => downloadExport(engine, input),
    build: (exportId, now) => buildExport(engine, exportId, now ?? new Date()),
    sweep: (now) => sweepExports(engine, now),
    beforeErase: (tenantId) => eraseExports(engine, tenantId),
    expiryOf: (now, purgeAt) => expiryOf(engine, now, purgeAt),
    archiveFilename: (tenantId, now) => archiveFilename(engine, tenantId, now),
    noticeWords: (payload, at) => noticeWords(engine, payload, at),
  };
}
