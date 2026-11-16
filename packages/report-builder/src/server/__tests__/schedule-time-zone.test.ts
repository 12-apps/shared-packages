import { describe, expect, it, vi } from 'vitest';

import { defineCatalog } from '../../catalog';
import { createMemoryDataSource } from '../../memory';
import { PT_BR_REPORT_ENGINE_COPY } from '../../pt-BR';
import type { ReportSchedule } from '../../schedule';
import { createApiReportBuilder, type ReportActor, type ReportRoute } from '../create-report-builder';
import { PT_BR_REPORT_SERVER_MESSAGES } from '../pt-BR';
import type { SavedReportDb, SavedReportRecord } from '../saved';

/**
 * Which zone a schedule is stamped in (FUT-776).
 *
 * `timeZone` is the platform's one answer; `resolveTimeZone` lets a host give
 * each tenant its own. These cases pin that the hook is used when a schedule is
 * WRITTEN (create, update, publish), that the day the fortnight anchors on is
 * read on that clock, and that a host which never adds the hook gets exactly
 * what it got before.
 */

const CATALOG = defineCatalog({
  entities: {
    orders: {
      label: 'Pedidos',
      fields: { totalCents: { label: 'Receita', type: 'money', role: 'measure' } },
    },
  },
});

const SPEC = {
  entity: 'orders',
  dimensions: [],
  measures: [{ field: 'totalCents' }],
  filters: [],
  sort: [],
  presentation: { kind: 'kpi' },
};

/** 23:30 on Monday 16 Nov in São Paulo, already 15:30 Tuesday 17 Nov in Auckland. */
const NOW = new Date('2026-11-17T02:30:00Z');

const ACTOR: ReportActor = {
  clientId: 'tenant-1',
  userId: 'user-1',
  roleIds: [],
  isAdmin: false,
  permissions: ['orders:read', 'reports:manage'],
};

const SCHEDULE = { enabled: true, cadence: 'daily', time: '08:00', recipients: ['u1'] };

function existing(overrides: Partial<SavedReportRecord> = {}): SavedReportRecord {
  return {
    id: 'r1',
    name: 'Vendas',
    description: null,
    spec: SPEC,
    status: 'published',
    visibility: 'tenant',
    visibilityRoles: [],
    defaultRange: null,
    workingCopy: null,
    schedule: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } as SavedReportRecord;
}

function setup(resolveTimeZone?: (actor: ReportActor) => string | Promise<string>) {
  const written: { schedule?: ReportSchedule | null }[] = [];
  const db = {
    savedReport: {
      findMany: () => Promise.resolve([]),
      findFirst: () => Promise.resolve(existing()),
      create: ({ data }: { data: { schedule?: ReportSchedule | null } }) => {
        written.push(data);
        return Promise.resolve(existing());
      },
      updateMany: ({ data }: { data: { schedule?: ReportSchedule | null } }) => {
        written.push(data);
        return Promise.resolve({ count: 1 });
      },
      deleteMany: () => Promise.resolve({ count: 0 }),
    },
  } as unknown as SavedReportDb;
  const { routes } = createApiReportBuilder({
    catalog: CATALOG,
    adapter: () => createMemoryDataSource({ orders: [] }, PT_BR_REPORT_ENGINE_COPY.labels.othersBucket),
    copy: PT_BR_REPORT_ENGINE_COPY,
    messages: PT_BR_REPORT_SERVER_MESSAGES,
    db: () => Promise.resolve(db),
    entityPermission: { orders: 'orders:read' },
    systemReports: [],
    starters: {},
    timeZone: 'America/Sao_Paulo',
    now: () => NOW,
    ...(resolveTimeZone ? { resolveTimeZone } : {}),
  });
  const call = (method: ReportRoute['method'], path: string, body: unknown) => {
    const route = routes.find((candidate) => candidate.method === method && candidate.path === path);
    if (!route) throw new Error(`No route for ${method} ${path}`);
    return route.handle({ actor: ACTOR, params: { id: 'r1' }, query: {}, body });
  };
  return { call, written };
}

const SAVE = { name: 'Vendas', spec: SPEC, status: 'published' };

describe('the zone a schedule is stamped in', () => {
  it('is the config zone when the host gives no hook, exactly as before', async () => {
    const { call, written } = setup();
    await call('POST', '/reports/custom', { ...SAVE, schedule: SCHEDULE });
    expect(written[0]?.schedule).toMatchObject({ timeZone: 'America/Sao_Paulo', startsOn: '2026-11-16' });
  });

  it('is the tenant zone the hook names, and the anchor day is read on that clock', async () => {
    const hook = vi.fn((actor: ReportActor) => (actor.clientId === 'tenant-1' ? 'Pacific/Auckland' : 'UTC'));
    const { call, written } = setup(hook);
    await call('POST', '/reports/custom', { ...SAVE, schedule: SCHEDULE });
    expect(written[0]?.schedule).toMatchObject({ timeZone: 'Pacific/Auckland', startsOn: '2026-11-17' });
    expect(hook).toHaveBeenCalledWith(ACTOR);
  });

  it('accepts a hook that answers asynchronously, on an update too', async () => {
    const { call, written } = setup(() => Promise.resolve('America/Manaus'));
    await call('PUT', '/reports/custom/:id', { ...SAVE, schedule: { ...SCHEDULE, cadence: 'weekly', weekday: 1 } });
    expect(written[0]?.schedule).toMatchObject({ timeZone: 'America/Manaus' });
  });

  it('is used when a parked edit is published', async () => {
    const { call, written } = setup(() => 'America/Manaus');
    await call('POST', '/reports/custom/:id/working-copy/publish', { ...SAVE, schedule: SCHEDULE });
    expect(written[0]?.schedule).toMatchObject({ timeZone: 'America/Manaus', startsOn: '2026-11-16' });
  });

  it('falls back to the config zone for a zone this runtime does not know', async () => {
    const { call, written } = setup(() => 'Mars/Olympus');
    await call('POST', '/reports/custom', { ...SAVE, schedule: SCHEDULE });
    expect(written[0]?.schedule).toMatchObject({ timeZone: 'America/Sao_Paulo' });
  });

  it('does not ask the host when the save writes no schedule', async () => {
    const hook = vi.fn(() => 'America/Manaus');
    const { call, written } = setup(hook);
    await call('POST', '/reports/custom', SAVE);
    await call('POST', '/reports/custom', { ...SAVE, schedule: null });
    expect(hook).not.toHaveBeenCalled();
    expect(written[0]?.schedule).toBeNull();
  });
});
