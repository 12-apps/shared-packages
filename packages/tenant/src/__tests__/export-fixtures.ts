import type { Readable } from 'node:stream';

import {
  createTenantExport,
  type TenantArchiveOpened,
  type TenantArchivePort,
  type TenantDataExportRow,
  type TenantDataExportTable,
  type TenantDataExportUpdate,
  type TenantDataExportWhere,
  type TenantExportAuditEvent,
  type TenantExportConfig,
  type TenantExportEnqueue,
  type TenantExportNoticePayload,
  type TenantExportSection,
} from '../export';
import type { TenantClosingRow } from '../lifecycle';
import { lifecycleHost } from './lifecycle-fixtures';

/* eslint-disable test-flakiness/no-global-state-mutation --
   The counters and rows are a fake host's own state, built fresh per test. */

/**
 * The clinic network of `lifecycle-fixtures.ts` with the data export wired:
 * an in-memory `tenant_data_exports` (Prisma-shaped filters, a one-PREPARING
 * per tenant unique rule), an older export table it mirrors into, an archive
 * port holding objects in memory, and logs of every notice, audit line and
 * queued build. Nothing here names the host the engine was extracted from.
 */

interface Tx {
  label: 'tx';
}

type Row = TenantDataExportRow;

/** Thrown by the fake table on a second PREPARING row of one tenant. */
export class UniqueViolation extends Error {}

function compare(value: unknown, bound: unknown): number {
  const left = value instanceof Date ? value.getTime() : (value as number);
  const right = bound instanceof Date ? bound.getTime() : (bound as number);
  return left - right;
}

function fieldMatches(value: unknown, expected: unknown): boolean {
  if (expected === null) return value === null;
  if (expected instanceof Date) return value instanceof Date && value.getTime() === expected.getTime();
  if (typeof expected === 'object') {
    if (value === null || value === undefined) return false;
    const range = expected as { lt?: unknown; gt?: unknown; lte?: unknown; gte?: unknown };
    if (range.lt !== undefined && !(compare(value, range.lt) < 0)) return false;
    if (range.gt !== undefined && !(compare(value, range.gt) > 0)) return false;
    if (range.lte !== undefined && !(compare(value, range.lte) <= 0)) return false;
    return !(range.gte !== undefined && !(compare(value, range.gte) >= 0));
  }
  return value === expected;
}

/** Prisma's `where`, for the keys the engine writes. */
export function matches(row: Row, where: TenantDataExportWhere | Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true;
    if (key === 'OR') return (expected as Record<string, unknown>[]).some((branch) => matches(row, branch));
    return fieldMatches(row[key as keyof Row], expected);
  });
}

/** Prisma's `data`: values set, `attempts` incremented. */
export function applied(row: Row, data: TenantDataExportUpdate): Row {
  const { attempts, ...set } = data;
  return { ...row, ...set, attempts: attempts === undefined ? row.attempts : row.attempts + 1 };
}

export function exportRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'e1',
    tenantId: 't-1',
    requestedById: 'user-1',
    status: 'PREPARING',
    requestedAt: new Date('2026-11-25T11:00:00.000Z'),
    startedAt: null,
    readyAt: null,
    expiresAt: null,
    storageKey: null,
    sizeBytes: null,
    attempts: 0,
    notifiedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

/** Read a stream whole: the fake archive port keeps the bytes it was given. */
export async function bytesOf(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Two small sections: a whole file and a CSV of two pages. */
export function clinicSections(): TenantExportSection[] {
  return [
    { kind: 'file', name: 'catalogue.csv', data: async () => 'code,name\r\nX1,Consult\r\n' },
    {
      kind: 'rows',
      name: (at) => (at.locale === 'pt-BR' ? 'pacientes.csv' : 'patients.csv'),
      header: () => ['Patient', 'Seen'],
      pages: async function* pages() {
        yield [['Ana', { raw: '01/11/2026' }]];
        yield [['=1+1', { raw: '-2' }]];
      },
    },
  ];
}

export function exportHost(options: { sections?: TenantExportSection[] } = {}) {
  const host = lifecycleHost();
  const rows = new Map<string, Row>();
  const legacy = new Map<string, Row>();
  const objects = new Map<string, Buffer>();
  const log: string[] = [];
  const notices: { type: string; payload: TenantExportNoticePayload }[] = [];
  const audits: { action: string; event: TenantExportAuditEvent }[] = [];
  const queued: { exportId: string; why: TenantExportEnqueue }[] = [];
  const knobs = {
    actor: { tenantId: 't-1', actorUserId: 'user-1' as string | null },
    authorizeRefuses: null as Error | null,
    notifyRecords: true as boolean | 'throws',
    presign: 'redirect' as 'redirect' | 'stream',
    deleteTenantRefuses: false,
    /** Called once inside `putStream`, after the object landed: the purge a test lands mid-build. */
    afterPut: null as null | (() => Promise<void>),
    /** What the tenant port's `timeZone` answers. */
    timeZone: 'Europe/London',
  };

  const table: TenantDataExportTable = {
    create: async ({ data }) => {
      log.push('create');
      const clash = [...rows.values()].some((row) => row.tenantId === data.tenantId && row.status === 'PREPARING');
      if (clash && data.status === 'PREPARING') throw new UniqueViolation('one PREPARING per tenant');
      rows.set(data.id, exportRow({ ...data }));
      return null;
    },
    findUnique: async ({ where }) => {
      const row = rows.get(where.id);
      return row ? { ...row } : null;
    },
    findFirst: async ({ where }) => {
      const row = [...rows.values()].find((candidate) => matches(candidate, where));
      return row ? { ...row } : null;
    },
    findMany: async ({ where, take }) => {
      log.push('findMany');
      return [...rows.values()]
        .filter((row) => matches(row, where))
        .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime())
        .slice(0, take)
        .map((row) => ({ ...row }));
    },
    updateMany: async ({ where, data }) => {
      log.push(`updateMany:${Object.keys(data).join(',')}`);
      const hit = [...rows.values()].filter((row) => matches(row, where));
      for (const row of hit) rows.set(row.id, applied(row, data));
      return { count: hit.length };
    },
    deleteMany: async ({ where }) => {
      log.push('deleteRows');
      const hit = [...rows.values()].filter((row) => row.tenantId === where.tenantId);
      for (const row of hit) rows.delete(row.id);
      return { count: hit.length };
    },
  };

  const archives: TenantArchivePort = {
    key: (tenantId, exportId) => `exports/${tenantId}/${exportId}.zip`,
    putStream: async (key, body, size) => {
      const bytes = await bytesOf(body);
      if (bytes.length !== size) throw new Error(`size ${size} is not ${bytes.length}`);
      objects.set(key, bytes);
      log.push(`put:${key}`);
      const after = knobs.afterPut;
      knobs.afterPut = null;
      if (after) await after();
    },
    presign: async (key, filename): Promise<TenantArchiveOpened> => {
      log.push(`presign:${key}:${filename}`);
      const bytes = objects.get(key);
      if (bytes === undefined) return { kind: 'missing' };
      if (knobs.presign === 'redirect') return { kind: 'redirect', url: `https://bucket.test/${key}?sig=1` };
      return { kind: 'stream', body: new Response(new Uint8Array(bytes)).body as ReadableStream<Uint8Array> };
    },
    delete: async (key) => {
      log.push(`delete:${key}`);
      objects.delete(key);
    },
    deleteTenant: async (tenantId) => {
      log.push('deleteObjects');
      if (knobs.deleteTenantRefuses) throw new Error('AccessDenied');
      for (const key of [...objects.keys()]) if (key.startsWith(`exports/${tenantId}/`)) objects.delete(key);
    },
  };

  const config: TenantExportConfig<Tx> = {
    db: {
      transaction: (run) => host.lifecycle.db.transaction(run),
      table: () => table,
      isUniqueViolation: (error) => error instanceof UniqueViolation,
    },
    sections: options.sections ?? clinicSections(),
    archives,
    limits: { linkDays: 7, maxAttempts: 3, staleAfterMs: 15 * 60_000, beatEveryMs: 30_000, sweepBatch: 20 },
    copy: {
      locales: {
        'en-GB': { archiveFilename: (day) => `clinic-data-${day}.zip` },
        'pt-BR': { archiveFilename: (day) => `dados-da-clinica-${day}.zip` },
      },
    },
    archiveLocale: () => 'en-GB',
    authorize: async (_request, at) => {
      log.push(`authorize:${at.slug}:${at.permission}`);
      if (knobs.authorizeRefuses) throw knobs.authorizeRefuses;
      return { ...knobs.actor };
    },
    enqueueBuild: async (exportId, why) => {
      queued.push({ exportId, why });
    },
    notify: async (type, payload) => {
      if (knobs.notifyRecords === 'throws') throw new Error('inbox down');
      if (!knobs.notifyRecords) return false;
      notices.push({ type, payload });
      return true;
    },
    audit: async (_tx, action, event) => {
      audits.push({ action, event });
    },
    mirror: {
      created: async (_tx, row) => {
        legacy.set(row.id, exportRow({ ...row }));
      },
      updated: async (_tx, id, data) => {
        const row = legacy.get(id);
        if (row) legacy.set(id, applied(row, data));
      },
      deleted: async (_tx, tenantId) => {
        for (const row of [...legacy.values()]) if (row.tenantId === tenantId) legacy.delete(row.id);
      },
    },
  };

  const tenant = host.tenant();
  const port = { ...host.config.port, timeZone: async () => knobs.timeZone };
  const build = (overrides: Partial<TenantExportConfig<Tx>> = {}) =>
    createTenantExport({ ...tenant, port }, host.lifecycle, { ...config, ...overrides });

  /** A closing row for t-1, so the link's cap has a purge date to read. */
  const closeWith = (purgeAt: Date): void => {
    const row: TenantClosingRow = {
      tenantId: 't-1',
      requestedAt: new Date('2026-11-20T00:00:00.000Z'),
      requestedById: 'user-1',
      reason: 'moving',
      priorStatus: 'OPEN',
      purgeAt,
      remindedWeekAt: null,
      remindedDayAt: null,
      purgedAt: null,
      afterCloseDoneAt: null,
      afterCloseFailedAt: null,
    };
    host.state.closings.push(row);
  };

  return { host, config, build, rows, legacy, objects, log, notices, audits, queued, knobs, closeWith, archives, table };
}

export const exportRequest = (): Request => new Request('https://host.test/admin/north/closing/export', { method: 'POST' });
