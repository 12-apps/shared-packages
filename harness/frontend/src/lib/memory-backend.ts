import { createMemoryDataSource, defineCatalog } from '@12-apps/report-builder';
import { reportBuilderRouter } from '@12-apps/report-builder/hono';
import type { ReportActor, SavedReportDb, SystemReportDef } from '@12-apps/report-builder/server';
import type { ReportBuilderTransport } from '@12-apps/report-builder/react';
import { Hono } from 'hono';

import { NOW, rowsInWindow } from './report-orders-fixture';

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
        revenueCents: { label: 'Receita', type: 'money', role: 'measure' },
        itemCount: { label: 'Itens', type: 'number', role: 'measure' },
      },
    },
  },
});

/** The permission tier the shipped policy assigns to `orders`. */
const SALES = 'reports:sales:read';

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
        measures: [{ field: 'revenueCents' }],
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
        measures: [{ field: 'revenueCents' }],
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
        measures: [{ field: 'revenueCents' }],
        presentation: { kind: 'table' },
      },
    },
  ],
};

/** A one-block document, for the cards whose point is that they are SMALL. */
function singleBlockDashboard(id: string, title: string): unknown {
  return {
    kind: 'dashboard',
    blocks: [{ id, span: 12, title, spec: DASHBOARD.blocks[0]?.spec }],
  };
}

/** A document big enough to saturate the list card's six-bar sparkline. */
function wideDashboard(): unknown {
  return {
    kind: 'dashboard',
    blocks: Array.from({ length: 7 }, (_, index) => ({
      id: `b${index + 1}`,
      span: 4,
      title: `Bloco ${index + 1}`,
      spec: DASHBOARD.blocks[0]?.spec,
    })),
  };
}

/** Minutes/days ago, from the real clock — a card's "há 2 min" never rots. */
function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

/** One stored row, with the fields a fixture rarely wants to restate. */
function row(patch: Partial<StoredRow> & { id: string; name: string }): StoredRow {
  return {
    description: null,
    spec: singleBlockDashboard(patch.id, patch.name),
    status: 'published',
    visibility: 'tenant',
    visibilityRoles: [],
    createdBy: 'u1',
    createdAt: new Date('2026-06-01T12:00:00Z'),
    updatedAt: minutesAgo(60 * 24 * 7),
    ...patch,
  };
}

/**
 * Storage is per-transport, so each mount starts from the same fixture.
 *
 * Two rows were enough when the screen was a list of rows. The card grid is a
 * COMPARISON — sizes, scopes, staleness, who authored what — and two cards
 * show none of it. These seven cover every state a card renders: both chips,
 * all three visibilities, one block against seven, a missing description, an
 * author who is not the caller, and edit times from minutes to weeks.
 */
function seedRows(): StoredRow[] {
  return [
    row({
      id: 'r1',
      name: 'Vendas por forma de pagamento',
      description: 'Receita diária separada por PIX, cartão e garçom',
      spec: DASHBOARD,
      updatedAt: minutesAgo(60 * 24 * 9),
    }),
    row({
      id: 'r2',
      name: 'Ticket médio',
      spec: {
        entity: 'orders',
        dimensions: [],
        measures: [{ field: 'revenueCents', aggregation: 'avg' }],
        presentation: { kind: 'kpi' },
      },
      status: 'archived',
      visibility: 'private',
      updatedAt: new Date('2026-06-15T18:00:00Z'),
    }),
    row({
      id: 'r3',
      name: 'Movimento por hora',
      description: 'A que horas a loja enche — pedidos por faixa de hora, no período.',
      spec: wideDashboard(),
      updatedAt: minutesAgo(12),
    }),
    row({
      id: 'r4',
      name: 'Fechamento do caixa',
      spec: singleBlockDashboard('caixa', 'Total do dia'),
      status: 'draft',
      visibility: 'private',
      updatedAt: minutesAgo(60 * 26),
    }),
    row({
      id: 'r5',
      name: 'Metas da equipe',
      description: 'Painel da gerência: quanto cada turno vendeu contra a meta do mês.',
      spec: DASHBOARD,
      visibility: 'roles',
      visibilityRoles: ['gerente'],
      // Someone ELSE authored it, so `Meus` has something to leave out.
      createdBy: 'u2',
      updatedAt: minutesAgo(60 * 24 * 3),
    }),
    row({
      id: 'r6',
      name: 'Perdas por motivo',
      description: 'Quanto saiu do estoque sem virar venda, por motivo declarado.',
      updatedAt: minutesAgo(60 * 24 * 16),
    }),
    row({
      id: 'r7',
      name: 'Cardápio antigo',
      description: 'Vendas do cardápio de verão — mantido para consulta.',
      status: 'archived',
      createdBy: 'u2',
      updatedAt: new Date('2026-05-20T12:00:00Z'),
    }),
  ];
}

/** The structural `SavedReportDb` seam a real host fills with Prisma. */
function memoryDb(): SavedReportDb {
  const state = { rows: seedRows(), next: 7 };
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
      adapter: ({ window }) => createMemoryDataSource({ orders: rowsInWindow(window) }),
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
