import {
  createMemoryDataSource,
  defineCatalog,
  listCatalogFields,
  runDashboard,
  runReport,
} from '@12-apps/report-builder';
import type { ReportBuilderTransport } from '@12-apps/report-builder/react';

/**
 * The harness's stand-in for a host backend.
 *
 * This is the ONLY part of wiring the reports surface that is genuinely the
 * host's: which tenant, and how a request is answered. A real host answers
 * over HTTP from its own endpoints; the harness answers in memory because it
 * has no server.
 *
 * It is not a mock of the package. The catalog, the compiler, the executor and
 * the renderer are all the PUBLISHED ones — only the rows and the storage are
 * local. So a screen that renders here has driven the same pipeline a real
 * deployment would.
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

const adapter = createMemoryDataSource({ orders: ROWS });
const options = { catalog, adapter, timeZone: 'America/Sao_Paulo' };

const RANGE = { preset: '30d', from: '2026-06-06', toExclusive: '2026-07-06' };

interface StoredReport {
  id: string;
  name: string;
  description: string | null;
  status: string;
  visibility: string;
  visibilityRoles: string[];
  updatedAt: string;
  spec: unknown;
}

/** Storage is per-transport, so each mount starts from the same fixture. */
function seedStore(): Map<string, StoredReport> {
  const dashboard = {
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
  return new Map([
    [
      'r1',
      {
        id: 'r1',
        name: 'Vendas por forma de pagamento',
        description: 'Receita diária separada por PIX, cartão e garçom',
        status: 'published',
        visibility: 'tenant',
        visibilityRoles: [],
        updatedAt: '2026-08-01T12:00:00Z',
        spec: dashboard,
      },
    ],
    [
      'r2',
      {
        id: 'r2',
        name: 'Ticket médio',
        description: null,
        status: 'archived',
        visibility: 'private',
        visibilityRoles: [],
        updatedAt: '2026-06-15T18:00:00Z',
        spec: {
          entity: 'orders',
          dimensions: [],
          measures: [{ field: 'totalCents', aggregation: 'avg' }],
          presentation: { kind: 'kpi' },
        },
      },
    ],
  ]);
}

function summaryOf(report: StoredReport) {
  const spec = report.spec as { kind?: string };
  return {
    id: report.id,
    name: report.name,
    description: report.description,
    type: spec.kind === 'dashboard' ? ('dashboard' as const) : ('report' as const),
    entity: 'orders',
    entities: ['orders'],
    status: report.status,
    visibility: report.visibility,
    updatedAt: report.updatedAt,
  };
}

async function viewOf(report: StoredReport): Promise<unknown> {
  const spec = report.spec as { kind?: string };
  const base = {
    id: report.id,
    name: report.name,
    description: report.description,
    status: report.status,
    visibility: report.visibility,
    visibilityRoles: report.visibilityRoles,
    range: RANGE,
  };

  if (spec.kind === 'dashboard') {
    const result = await runDashboard(report.spec, options);
    return {
      ...base,
      type: 'dashboard',
      spec: report.spec,
      blocks: result.blocks.map((block) => ({
        id: block.id,
        title: block.title,
        span: block.span,
        sentence: block.sentence,
        ...(block.status === 'ok'
          ? { status: 'ok', render: block.render }
          : { status: 'error', error: block.error }),
      })),
    };
  }

  const result = await runReport(report.spec, options);
  return { ...base, type: 'report', spec: report.spec, render: result.render };
}

export function memoryBackend(): ReportBuilderTransport {
  const store = seedStore();
  let nextId = 3;

  return {
    async get<T>(path: string): Promise<T> {
      if (path.includes('/reports/fields')) {
        return listCatalogFields(catalog) as T;
      }
      if (path.includes('/reports/custom/')) {
        const id = decodeURIComponent(path.split('/reports/custom/')[1]!.split('?')[0]!);
        const report = store.get(id);
        if (!report) throw new Error(`no such report: ${id}`);
        return (await viewOf(report)) as T;
      }
      if (path.includes('/reports/custom')) {
        return { reports: [...store.values()].map(summaryOf) } as T;
      }
      throw new Error(`memoryBackend: unhandled GET ${path}`);
    },

    getRaw<T>(path: string): Promise<T> {
      // The roles picker: an empty page, which is a legitimate answer — the
      // harness tenant has no custom roles.
      if (path.includes('/roles')) {
        return Promise.resolve({ data: [], pagination: { hasNextPage: false } } as T);
      }
      return Promise.reject(new Error(`memoryBackend: unhandled raw GET ${path}`));
    },

    async send<T>(path: string, method: string, body?: unknown) {
      if (path.includes('/reports/run')) {
        const input = body as { spec: unknown };
        try {
          const result = await runReport(input.spec, options);
          return { ok: true as const, data: { range: RANGE, render: result.render } as T };
        } catch (error) {
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : 'run failed',
          };
        }
      }

      if (path.includes('/reports/custom')) {
        const input = body as {
          name: string;
          description?: string;
          spec: unknown;
          status: string;
          visibility: string;
          visibilityRoles: string[];
        };
        const existing = path.match(/\/reports\/custom\/([^/?]+)/)?.[1];
        const id = existing ? decodeURIComponent(existing) : `r${(nextId += 1)}`;
        const saved: StoredReport = {
          id,
          name: input.name,
          description: input.description ?? null,
          status: input.status,
          visibility: input.visibility,
          visibilityRoles: input.visibilityRoles,
          updatedAt: '2026-08-06T00:00:00Z',
          spec: input.spec,
        };
        store.set(id, saved);
        return { ok: true as const, data: summaryOf(saved) as T };
      }

      return { ok: false as const, error: `memoryBackend: unhandled ${method} ${path}` };
    },
  };
}
