import { createMemoryDataSource, defineCatalog } from '@12-apps/report-builder';
import { reportBuilderRouter } from '@12-apps/report-builder/hono';
import type { ReportActor, SavedReportDb, SystemReportDef } from '@12-apps/report-builder/server';
import type { ReportBuilderTransport } from '@12-apps/report-builder/react';
import { Hono } from 'hono';

/**
 * The harness's stand-in for a host backend.
 *
 * It answers with the package's OWN endpoints, mounted through its OWN Hono
 * binding. That is the whole point: the reports client and the reports server
 * are two halves of one contract, and for as long as this file hand-wrote the
 * responses it was possible for them to disagree and for every suite to stay
 * green. They did disagree — the client sent `PUT` at a server that only
 * answered `PATCH`, and nothing could see it, because no test crossed both
 * halves. This one does.
 *
 * Hono is isomorphic: `router.request()` builds a `Request` and returns a
 * `Response` with no socket involved, so the published adapter runs unchanged
 * in the browser.
 *
 * What is genuinely the HOST's, and all that is left here: which tenant, who
 * is calling, where the rows come from, and where documents are stored.
 */
const catalog = defineCatalog({
  entities: {
    orders: {
      label: 'Pedidos',
      fields: {
        id: { label: 'Pedido', type: 'string', role: 'dimension' },
        createdAt: { label: 'Data', type: 'date', role: 'dimension' },
        method: {
          label: 'Forma de pagamento',
          type: 'string',
          role: 'dimension',
          values: [
            { value: 'PIX', label: 'PIX' },
            { value: 'CARD', label: 'Cartão' },
            { value: 'WAITER', label: 'Com o garçom' },
          ],
        },
        status: {
          label: 'Status',
          type: 'string',
          role: 'dimension',
          values: [
            { value: 'PAID', label: 'Pago' },
            { value: 'AWAITING_PAYMENT', label: 'Aguardando pagamento' },
            { value: 'FAILED', label: 'Falhou' },
          ],
        },
        totalCents: { label: 'Receita', type: 'money', role: 'measure' },
        itemCount: { label: 'Itens', type: 'number', role: 'measure' },
      },
    },
  },
});

const ROWS = [
  { id: 'o1', createdAt: '2026-07-01T10:00:00Z', method: 'PIX', status: 'PAID', totalCents: 1000, itemCount: 1 },
  { id: 'o2', createdAt: '2026-07-01T14:00:00Z', method: 'CARD', status: 'PAID', totalCents: 2500, itemCount: 3 },
  { id: 'o3', createdAt: '2026-07-02T02:00:00Z', method: 'PIX', status: 'PAID', totalCents: 3000, itemCount: 2 },
  { id: 'o4', createdAt: '2026-07-03T09:00:00Z', method: 'WAITER', status: 'FAILED', totalCents: 800, itemCount: 1 },
  { id: 'o5', createdAt: '2026-07-04T20:00:00Z', method: 'CARD', status: 'PAID', totalCents: 4200, itemCount: 4 },
];

/** The permission tier the shipped policy assigns to `orders`. */
const SALES = 'reports:sales:read';

/**
 * Frozen so the fixture rows are always inside the window. A rolling preset
 * resolved against the real clock would empty every report the moment July
 * 2026 fell out of the last thirty days.
 */
const NOW = new Date('2026-07-05T12:00:00Z');

/**
 * A built-in defined over THIS catalog. The shipped presets are written
 * against Future Pay's real fields, which this fixture does not have.
 */
const SYSTEM_REPORTS: SystemReportDef[] = [
  {
    key: 'receita-por-forma',
    title: 'Receita por forma de pagamento',
    description: 'Quanto entrou por PIX, cartão e garçom no período.',
    permission: SALES as SystemReportDef['permission'],
    section: 'orders',
    supportsGrain: false,
    presentation: 'chart',
    build: () =>
      ({
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'totalCents' }],
        filters: [{ field: 'status', operator: 'eq', value: 'PAID' }],
        presentation: { kind: 'chart', chartType: 'bar' },
      }) as never,
  },
];

interface StoredRow {
  id: string;
  name: string;
  description: string | null;
  spec: unknown;
  status: string;
  visibility: string;
  visibilityRoles: unknown;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const DASHBOARD = {
  kind: 'dashboard',
  blocks: [
    {
      id: 'revenue',
      span: 6,
      title: 'Receita por forma',
      spec: {
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'totalCents' }],
        filters: [{ field: 'status', operator: 'eq', value: 'PAID' }],
        presentation: { kind: 'chart', chartType: 'bar' },
      },
    },
    {
      id: 'daily',
      span: 6,
      spec: {
        entity: 'orders',
        dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
        measures: [{ field: 'totalCents' }],
        presentation: { kind: 'table' },
      },
    },
  ],
};

/** Storage is per-transport, so each mount starts from the same fixture. */
function seedRows(): StoredRow[] {
  return [
    {
      id: 'r1',
      name: 'Vendas por forma de pagamento',
      description: 'Receita diária separada por PIX, cartão e garçom',
      spec: DASHBOARD,
      status: 'published',
      visibility: 'tenant',
      visibilityRoles: [],
      createdBy: 'u1',
      createdAt: new Date('2026-06-01T12:00:00Z'),
      updatedAt: new Date('2026-08-01T12:00:00Z'),
    },
    {
      id: 'r2',
      name: 'Ticket médio',
      description: null,
      spec: {
        entity: 'orders',
        dimensions: [],
        measures: [{ field: 'totalCents', aggregation: 'avg' }],
        presentation: { kind: 'kpi' },
      },
      status: 'archived',
      visibility: 'private',
      visibilityRoles: [],
      createdBy: 'u1',
      createdAt: new Date('2026-06-01T12:00:00Z'),
      updatedAt: new Date('2026-06-15T18:00:00Z'),
    },
  ];
}

/** The structural `SavedReportDb` seam a real host fills with Prisma. */
function memoryDb(): SavedReportDb {
  const state = { rows: seedRows(), next: 2 };
  return {
    savedReport: {
      findMany: () => Promise.resolve(state.rows.slice()),
      findFirst: ({ where }: { where: { id?: string } }) =>
        Promise.resolve(state.rows.find((row) => row.id === where.id) ?? null),
      create: ({ data }: { data: Record<string, unknown> }) => {
        state.next += 1;
        const created = {
          ...(data as unknown as StoredRow),
          id: `r${state.next}`,
          createdAt: NOW,
          updatedAt: NOW,
        };
        state.rows = [...state.rows, created];
        return Promise.resolve(created);
      },
      updateMany: ({ where, data }: { where: { id?: string }; data: Record<string, unknown> }) => {
        const match = state.rows.find((row) => row.id === where.id);
        state.rows = state.rows.map((row) =>
          row.id === where.id ? ({ ...row, ...data, updatedAt: NOW } as StoredRow) : row,
        );
        return Promise.resolve({ count: match ? 1 : 0 });
      },
      deleteMany: ({ where }: { where: { id?: string } }) => {
        const before = state.rows.length;
        state.rows = state.rows.filter((row) => row.id !== where.id);
        return Promise.resolve({ count: before - state.rows.length });
      },
    },
  } as unknown as SavedReportDb;
}

const ACTOR: ReportActor = {
  clientId: 'harness',
  userId: 'u1',
  roleIds: [],
  isAdmin: true,
  canAuthor: true,
  permissions: [SALES],
};

/** Everything the package needs from a host, in one object. */
function buildRouter(): Hono {
  const db = memoryDb();
  const router = new Hono();
  router.route(
    '/api/admin/:tenantSlug',
    reportBuilderRouter({
      catalog,
      adapter: () => createMemoryDataSource({ orders: ROWS }),
      db: () => Promise.resolve(db),
      timeZone: 'America/Sao_Paulo',
      now: () => NOW,
      systemReports: SYSTEM_REPORTS,
      resolveActor: () => ACTOR,
    }),
  );
  return router;
}

/** The roles picker's endpoint, which belongs to the host, not to this package. */
const ROLES_PAGE = { data: [], pagination: { hasNextPage: false } };

export function memoryBackend(): ReportBuilderTransport {
  const router = buildRouter();

  async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
    const response = await router.request(path, init);
    const body = response.status === 204 ? null : ((await response.json()) as T);
    return { status: response.status, body: body as T };
  }

  return {
    async get<T>(path: string): Promise<T> {
      const result = await json<{ data: T }>(path);
      if (result.status >= 400) throw new Error(`HTTP ${result.status} for ${path}`);
      return result.body.data;
    },

    getRaw<T>(path: string): Promise<T> {
      // The harness tenant has no custom roles; an empty page is a legitimate
      // answer, and this endpoint is not the reports package's to serve.
      if (path.includes('/roles')) return Promise.resolve(ROLES_PAGE as T);
      return Promise.reject(new Error(`memoryBackend: unhandled raw GET ${path}`));
    },

    async send<T>(path: string, method: string, body?: unknown) {
      const result = await json<{ data?: T; error?: string }>(path, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (result.status >= 400) {
        return { ok: false as const, error: result.body?.error ?? `HTTP ${result.status}` };
      }
      return { ok: true as const, data: (result.body?.data ?? null) as T };
    },
  };
}
