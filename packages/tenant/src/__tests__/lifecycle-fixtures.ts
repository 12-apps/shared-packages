import type { TenantRecord, TenantTreeNode } from '../port';
import { createApiTenant, type TenantServerConfig } from '../server';
import type {
  TenantAuditEvent,
  TenantBlockerCount,
  TenantClosingEvent,
  TenantClosingRow,
  TenantClosingTable,
  TenantLifecycleConfig,
  TenantNoticePayload,
} from '../lifecycle';
import { coreConfig } from './fixtures';

/**
 * An in-memory clinic network with the lifecycle wired: tenant rows, closing
 * rows, a legacy mirror table, audit lines and notices, every write going
 * through a transaction that rolls the whole state back when its body throws.
 */

type ClinicStatus = 'OPEN' | 'WINDING_DOWN' | 'SHUT' | 'ON_HOLD' | 'AWAITING_REVIEW';

interface Tx {
  label: 'tx';
}

interface State {
  tenants: TenantRecord<ClinicStatus>[];
  closings: TenantClosingRow[];
  mirror: Record<string, Partial<TenantClosingRow>>;
  audit: { action: string; event: TenantAuditEvent }[];
}

export const DAY_MS = 24 * 60 * 60 * 1000;

const clone = (state: State): State => structuredClone(state);

export function lifecycleHost(options: { tree?: TenantTreeNode[] } = {}) {
  const state: State = {
    tenants: [
      { id: 't-1', slug: 'north', status: 'OPEN', name: 'Clínica Norte' },
      { id: 't-2', slug: 'south', status: 'ON_HOLD', name: 'Clínica Sul' },
    ],
    closings: [],
    mirror: {},
    audit: [],
  };
  const log: string[] = [];
  const notices: { type: string; payload: TenantNoticePayload }[] = [];
  const errors: { act: string; tenantId: string; error: unknown }[] = [];
  /** What each `mirror.deleted` was handed: the tenant and the deleted row's `requestedAt`. */
  const mirrorDeletes: { tenantId: string; requestedAt: Date | undefined }[] = [];
  const knobs = {
    blockers: [] as TenantBlockerCount[],
    /** Called on the close's recount (with tx): the race the recount exists for. */
    onRecount: null as null | (() => void),
    afterCloseFails: 0,
    afterCloseCalls: 0,
    notifyRecords: true,
    confirmRefuses: false,
    purge: 'purged' as 'purged' | 'already' | 'skipped',
    purgeCalls: 0,
    lastNode: undefined as TenantTreeNode | null | undefined,
  };
  const tenantOf = (id: string) => state.tenants.find((row) => row.id === id);
  const closingOf = (id: string) => state.closings.find((row) => row.tenantId === id);

  const table: TenantClosingTable = {
    findUnique: async ({ where }) => {
      log.push('findUnique');
      const row = closingOf(where.tenantId);
      return row ? { ...row } : null;
    },
    findMany: async ({ where, take }) => {
      log.push('findMany');
      const [later, same] = where.OR ?? [];
      const afterKey = (row: TenantClosingRow) =>
        later === undefined || same === undefined
          ? true
          : row.purgeAt.getTime() > later.purgeAt.gt.getTime() ||
            (row.purgeAt.getTime() === same.purgeAt.getTime() && row.tenantId > same.tenantId.gt);
      return state.closings
        .filter((row) => row.purgedAt === null && afterKey(row))
        .sort((a, b) => a.purgeAt.getTime() - b.purgeAt.getTime() || (a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0))
        .slice(0, take)
        .map((row) => ({ ...row }));
    },
    create: async ({ data }) => {
      log.push('create');
      state.closings.push({
        ...data,
        remindedWeekAt: null,
        remindedDayAt: null,
        purgedAt: null,
        afterCloseDoneAt: null,
        afterCloseFailedAt: null,
      });
      return null;
    },
    deleteMany: async ({ where }) => {
      log.push('deleteMany');
      const before = state.closings.length;
      const hit = (row: TenantClosingRow) =>
        row.tenantId === where.tenantId &&
        (where.requestedAt === undefined || row.requestedAt.getTime() === where.requestedAt.getTime()) &&
        (where.purgedAt === undefined || row.purgedAt === null);
      state.closings = state.closings.filter((row) => !hit(row));
      return { count: before - state.closings.length };
    },
    updateMany: async ({ where, data }) => {
      log.push('updateMany');
      const row = closingOf(where.tenantId);
      const nulls = Object.keys(where).filter((key) => key !== 'tenantId') as (keyof TenantClosingRow)[];
      if (!row || nulls.some((key) => row[key] !== null)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  };

  const config: TenantServerConfig<ClinicStatus, Tx> = {
    ...coreConfig(),
    port: {
      bySlug: async (slug) => state.tenants.find((row) => row.slug === slug) ?? null,
      byId: async (id) => {
        log.push(`byId:${id}`);
        const row = tenantOf(id);
        return row ? { ...row } : null;
      },
      setStatusIf: async (id, from, to) => {
        log.push(`setStatusIf:${from}->${to}`);
        const row = tenantOf(id);
        if (!row || row.status !== from) return false;
        row.status = to;
        return true;
      },
      clearProfile: async () => undefined,
      timeZone: async () => 'Europe/London',
    },
    ...(options.tree === undefined
      ? {}
      : {
          tree: {
            treeNode: async (id) => options.tree?.find((node) => node.id === id) ?? null,
            treeAncestors: async () => [],
            treeDescendants: async (id) => {
              log.push('treeDescendants');
              const self = options.tree?.find((node) => node.id === id);
              if (!self) return [];
              // The host's ONE read carries each node's status (required with the lifecycle).
              return (options.tree ?? [])
                .filter((node) => node.path.startsWith(self.path))
                .map((node) => ({ ...node, status: tenantOf(node.id)?.status }));
            },
            moveSubtree: async () => 0,
          },
        }),
  };

  const lifecycle: TenantLifecycleConfig<ClinicStatus, Tx> = {
    graceDays: 30,
    reminderDays: { week: 7, day: 1 },
    minReasonLength: 3,
    nameLocale: 'pt-BR',
    sweepBatch: 50,
    copy: {
      locales: {
        'en-GB': {
          noticePlatformScheduledTitle: (name) => `en-GB: platform title(${name}).`,
          noticePlatformScheduledBody: (name, day, reason) => `en-GB: platform body(${name}, ${day}, ${reason}).`,
          noticePlatformScheduledBodyNoReason: (name, day) => `en-GB: platform body, no reason(${name}, ${day}).`,
          noticeReopenedRestoredTitle: (name) => `en-GB: restored title(${name}).`,
          noticeReopenedRestoredBody: (name) => `en-GB: restored body(${name}).`,
        },
        'pt-BR': {
          noticePlatformScheduledTitle: (name) => `pt-BR: platform title(${name}).`,
          noticePlatformScheduledBody: (name, day, reason) => `pt-BR: platform body(${name}, ${day}, ${reason}).`,
          noticePlatformScheduledBodyNoReason: (name, day) => `pt-BR: platform body, no reason(${name}, ${day}).`,
          noticeReopenedRestoredTitle: (name) => `pt-BR: restored title(${name}).`,
          noticeReopenedRestoredBody: (name) => `pt-BR: restored body(${name}).`,
        },
      },
    },
    db: {
      transaction: async (run) => {
        const saved = clone(state);
        log.push('begin');
        try {
          const value = await run({ label: 'tx' });
          log.push('commit');
          return value;
        } catch (error) {
          Object.assign(state, saved); // restore in place: every reader holds this one object
          log.push('rollback');
          throw error;
        }
      },
      table: () => table,
    },
    blockers: {
      kinds: [
        { kind: 'patients', path: 'ward' },
        { kind: 'invoices', path: 'billing' },
      ],
      read: async (tenantId, at) => {
        log.push(at.tx === undefined ? 'blockers' : 'blockers:tx');
        if (at.tx !== undefined && knobs.onRecount) {
          knobs.onRecount();
          knobs.onRecount = null;
        }
        return knobs.blockers;
      },
    },
    ...(options.tree === undefined ? {} : { openDescendants: { kind: 'units', path: 'units' } }),
    confirmDangerousAct: async () => {
      log.push('confirm');
      if (knobs.confirmRefuses) throw new Error('PIN required');
    },
    afterClose: async ({ node }) => {
      knobs.afterCloseCalls += 1;
      knobs.lastNode = node;
      log.push('afterClose');
      if (knobs.afterCloseFails > 0) {
        knobs.afterCloseFails -= 1;
        throw new Error('billing timeout');
      }
    },
    invalidate: async () => {
      log.push('invalidate');
    },
    notify: async (type, payload) => {
      log.push(`notify:${type}`);
      if (!knobs.notifyRecords) return false;
      notices.push({ type, payload });
      return true;
    },
    onPurgeDue: async () => {
      knobs.purgeCalls += 1;
      log.push('purge');
      return knobs.purge;
    },
    audit: async (_tx, action, event) => {
      log.push(`audit:${action}`);
      state.audit.push({ action, event });
    },
    locale: () => null,
    onError: (error, at) => errors.push({ ...at, error }),
    mirror: {
      replaced: async (_tx, row) => {
        log.push('mirror:replaced');
        state.mirror[row.tenantId] = { ...row };
      },
      event: async (_tx, tenantId, event: TenantClosingEvent) => {
        log.push(`mirror:${event.kind}`);
        state.mirror[tenantId] = { ...state.mirror[tenantId], [`event:${event.kind}`]: event.at };
      },
      deleted: async (_tx, tenantId, requestedAt) => {
        log.push('mirror:deleted');
        mirrorDeletes.push({ tenantId, requestedAt });
        delete state.mirror[tenantId];
      },
    },
  };

  const build = (overrides: Partial<TenantLifecycleConfig<ClinicStatus, Tx>> = {}) =>
    createApiTenant({ ...config, lifecycle: { ...lifecycle, ...overrides } });

  return {
    config,
    lifecycle,
    build,
    tenant: () => build(),
    get state() {
      return state;
    },
    tenantOf,
    closingOf,
    log,
    notices,
    errors,
    mirrorDeletes,
    knobs,
  };
}

export const request = (): Request => new Request('https://host.test/admin/north/closing', { method: 'POST' });
