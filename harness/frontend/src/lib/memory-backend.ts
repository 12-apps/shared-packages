import { createMemoryDataSource } from '@12-apps/report-builder';
import { reportBuilderRouter } from '@12-apps/report-builder/hono';
import {
  REPORT_ENTITY_PERMISSION,
  type ReportActor,
  type SavedReportDb,
} from '@12-apps/report-builder/server';
import type { ReportBuilderTransport } from '@12-apps/report-builder/react';
import { Hono } from 'hono';

import { HARNESS_CATALOG } from './report-catalog';
import { fixtureTables } from './report-fixture-tables';
import { HARNESS_TIME_ZONE, NOW } from './report-fixture-window';
import { seedRows, type StoredRow } from './report-saved-fixture';

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
 * is calling, where the rows come from, and where documents are stored. The
 * catalog is `report-catalog.ts`, the rows are the fixtures beside it and the
 * saved documents are `report-saved-fixture.ts`; what is left here is wiring —
 * which is also what kept it under the size gate when the catalog went from one
 * entity to seven.
 */

/** The permission tier the shipped policy assigns to `orders`. */
const SALES = 'reports:sales:read';

/**
 * What the harness user may query, DERIVED from the shipped policy rather than
 * typed out: every tier the catalog's own entities require, and nothing else.
 *
 * Typing the list is how the old fixture would have failed. An entity absent
 * from an actor's permissions is indistinguishable from an entity that does not
 * exist — both answer *Acesso negado* — so a catalog that grew an entity while
 * this list stayed still would look exactly like the bug being fixed.
 */
const PERMISSIONS: string[] = [
  ...new Set(
    Object.keys(HARNESS_CATALOG.entities).map((entity) => {
      const permission = REPORT_ENTITY_PERMISSION[entity];
      if (!permission) throw new Error(`No shipped permission tier for entity "${entity}".`);
      return permission;
    }),
  ),
];

/**
 * A built-in's type, derived from the router's own config rather than imported.
 * `SystemReportDef` lives in the package's internal `preset-types` and its
 * server barrel does not re-export it, so naming it directly is a type error —
 * one the harness's bundler happens not to raise, because a type-only import is
 * erased before anything checks it.
 */
type SystemReport = NonNullable<Parameters<typeof reportBuilderRouter>[0]['systemReports']>[number];

/**
 * A built-in defined over THIS catalog rather than the shipped `SYSTEM_REPORTS`.
 * The catalog is now the product's, but a SUBSET of it — the shipped presets
 * reach for plan and promise measures this fixture deliberately leaves out, and
 * a preset that 400s is a worse fixture than one that is absent.
 */
const SYSTEM_REPORTS: SystemReport[] = [
  {
    key: 'receita-por-forma',
    title: 'Receita por forma de pagamento',
    description: 'Quanto entrou por PIX, cartão e garçom no período.',
    permission: SALES as SystemReport['permission'],
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
  permissions: PERMISSIONS,
};

/** Everything the package needs from a host, in one object. */
function buildRouter(): Hono {
  const db = memoryDb();
  const router = new Hono();
  router.route(
    '/api/admin/:tenantSlug',
    reportBuilderRouter({
      catalog: HARNESS_CATALOG,
      adapter: ({ window }) => createMemoryDataSource(fixtureTables(window)),
      db: () => Promise.resolve(db),
      timeZone: HARNESS_TIME_ZONE,
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
