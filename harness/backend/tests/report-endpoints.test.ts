import {
  createMemoryDataSource,
  defineCatalog,
  type FieldCatalog,
} from '@12-apps/report-builder';
import {
  createReportBuilder,
  documentShape,
  type ReportActor,
  type ReportRoute,
} from '@12-apps/report-builder/server';
import { describe, expect, it } from 'vitest';

/**
 * The endpoints, driven from the PUBLISHED tarball.
 *
 * These used to be six route files in the consuming app, which meant the
 * request contract and the client that calls it lived in different
 * repositories — and only the app's own e2e could tell whether they still
 * agreed. Now the contract is one artifact and this proves it without a
 * framework, a server, or a network.
 *
 * The database is a small in-memory stand-in behind the same structural seam a
 * host fills with Prisma, because what is under test is the HANDLER: its
 * status codes, its envelope and its visibility rules.
 */
const catalog: FieldCatalog = defineCatalog({
  entities: {
    orders: {
      label: 'Pedidos',
      fields: {
        id: { label: 'Pedido', type: 'string', role: 'dimension' },
        method: { label: 'Forma', type: 'string', role: 'dimension' },
        totalCents: { label: 'Receita', type: 'money', role: 'measure' },
      },
    },
  },
});

const adapter = createMemoryDataSource({
  orders: [
    { id: 'o1', method: 'PIX', totalCents: 1000 },
    { id: 'o2', method: 'CARD', totalCents: 2000 },
  ],
});

const SPEC = {
  entity: 'orders',
  dimensions: [{ field: 'method' }],
  measures: [{ field: 'totalCents' }],
  presentation: { kind: 'table' },
};

interface Row {
  id: string;
  clientId: string;
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

/**
 * The structural `SavedReportDb` seam, backed by an array it OWNS.
 *
 * State lives on a container property rather than in a closed-over binding the
 * stubs reassign — reassigning a captured variable from inside a stub is the
 * pattern the flakiness gate rejects, because it is how one test's writes leak
 * into the next.
 */
function memoryDb(seed: Row[]) {
  const state = { rows: [...seed], next: seed.length };
  return {
    all: () => state.rows,
    savedReport: {
      findMany: ({ where }: { where: { clientId: string } }) =>
        Promise.resolve(state.rows.filter((row) => row.clientId === where.clientId)),
      findFirst: ({ where }: { where: { id: string; clientId: string } }) =>
        Promise.resolve(
          state.rows.find((row) => row.id === where.id && row.clientId === where.clientId) ?? null,
        ),
      create: ({ data }: { data: Record<string, unknown> }) => {
        state.next += 1;
        const row = {
          ...(data as unknown as Row),
          id: `r${state.next}`,
          createdAt: new Date('2026-08-01T00:00:00Z'),
          updatedAt: new Date('2026-08-01T00:00:00Z'),
        };
        state.rows = [...state.rows, row];
        return Promise.resolve(row);
      },
      updateMany: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const match = state.rows.find((candidate) => candidate.id === where.id);
        state.rows = state.rows.map((row) =>
          row.id === where.id ? ({ ...row, ...data } as Row) : row,
        );
        return Promise.resolve({ count: match ? 1 : 0 });
      },
      deleteMany: ({ where }: { where: { id: string } }) => {
        const before = state.rows.length;
        state.rows = state.rows.filter((row) => row.id !== where.id);
        return Promise.resolve({ count: before - state.rows.length });
      },
    },
  };
}

const OWNER: ReportActor = {
  clientId: 'c1',
  userId: 'u1',
  roleIds: [],
  isAdmin: true,
  canAuthor: true,
};

const STAFF: ReportActor = {
  clientId: 'c1',
  userId: 'u2',
  roleIds: [],
  isAdmin: false,
  canAuthor: false,
};

function seedRows(): Row[] {
  return [
    {
      id: 'r1',
      clientId: 'c1',
      name: 'Publicado',
      description: null,
      spec: SPEC,
      status: 'published',
      visibility: 'tenant',
      visibilityRoles: [],
      createdBy: 'u1',
      createdAt: new Date('2026-07-01T00:00:00Z'),
      updatedAt: new Date('2026-07-01T00:00:00Z'),
    },
    {
      id: 'r2',
      clientId: 'c1',
      name: 'Rascunho de outra pessoa',
      description: null,
      spec: SPEC,
      status: 'draft',
      visibility: 'private',
      visibilityRoles: [],
      createdBy: 'u1',
      createdAt: new Date('2026-07-01T00:00:00Z'),
      updatedAt: new Date('2026-07-01T00:00:00Z'),
    },
  ];
}

/**
 * Everything a test touches is built INSIDE it. Module-level `let` rebuilt in
 * `beforeEach` would give the suite shared mutable state — and these tests
 * mutate rows, so one leaking into the next is exactly the order-dependence
 * that makes a suite flaky.
 */
function setup(): {
  stored: () => Row[];
  routes: ReportRoute[];
  route: (method: string, path: string) => ReportRoute;
} {
  const db = memoryDb(seedRows());
  const { routes } = createReportBuilder({
    catalog,
    adapter,
    db: () => Promise.resolve(db),
  });
  return {
    stored: db.all,
    routes,
    route(method, path) {
      const found = routes.find((entry) => entry.method === method && entry.path === path);
      if (!found) throw new Error(`no route ${method} ${path}`);
      return found;
    },
  };
}

describe('the package ships the endpoints, not the host', () => {
  it('exposes the whole reports contract as route descriptors', () => {
    const { route, routes } = setup();
    expect(routes.map((entry) => `${entry.method} ${entry.path}`).sort()).toEqual([
      'DELETE /reports/custom/:id',
      'GET /reports/custom',
      'GET /reports/custom/:id',
      'GET /reports/fields',
      'PATCH /reports/custom/:id',
      'POST /reports/custom',
      'POST /reports/run',
    ]);
  });

  it('answers the field catalog the builder authors against', async () => {
    const { route } = setup();
    const response = await route('GET', '/reports/fields').handle({
      actor: OWNER,
      params: {},
      query: {},
    });

    expect(response.status).toBe(200);
    const body = response.body as { data: { entities: Array<{ entity: string }> } };
    expect(body.data.entities.map((entity) => entity.entity)).toEqual(['orders']);
  });
});

describe('visibility is enforced by the handler', () => {
  it('shows an admin every saved report', async () => {
    const { route } = setup();
    const response = await route('GET', '/reports/custom').handle({
      actor: OWNER,
      params: {},
      query: {},
    });

    const body = response.body as { data: { reports: Array<{ id: string }> } };
    expect(body.data.reports.map((report) => report.id)).toEqual(['r1', 'r2']);
  });

  it("hides another author's private draft from non-admin staff", async () => {
    const { route } = setup();
    const response = await route('GET', '/reports/custom').handle({
      actor: STAFF,
      params: {},
      query: {},
    });

    const body = response.body as { data: { reports: Array<{ id: string }> } };
    expect(body.data.reports.map((report) => report.id)).toEqual(['r1']);
  });

  it('answers 404 — not 403 — for a report the actor may not see', async () => {
    const { route } = setup();
    // 403 would confirm the id exists, which is a disclosure on a tenant
    // surface where ids are guessable.
    const response = await route('GET', '/reports/custom/:id').handle({
      actor: STAFF,
      params: { id: 'r2' },
      query: {},
    });

    expect(response.status).toBe(404);
  });
});

describe('authoring is gated', () => {
  it('refuses a create from an actor who may not author', async () => {
    const { route, stored } = setup();
    const response = await route('POST', '/reports/custom').handle({
      actor: STAFF,
      params: {},
      query: {},
      body: { name: 'Novo', spec: SPEC, status: 'draft', visibility: 'private' },
    });

    expect(response.status).toBe(403);
    expect(stored()).toHaveLength(2);
  });

  it('takes authorship from the ACTOR, never from the body', async () => {
    const { route, stored } = setup();
    // A client that could name its own createdBy could author as someone else
    // — and authorship is what `visibility: private` is judged on.
    await route('POST', '/reports/custom').handle({
      actor: OWNER,
      params: {},
      query: {},
      body: {
        name: 'Novo',
        spec: SPEC,
        status: 'draft',
        visibility: 'private',
        createdBy: 'someone-else',
      },
    });

    expect(stored().at(-1)?.createdBy).toBe('u1');
  });
});

describe('a spec error is the author’s mistake, not a server fault', () => {
  it('answers 400 with the compiler’s own message', async () => {
    const { route } = setup();
    const response = await route('POST', '/reports/run').handle({
      actor: OWNER,
      params: {},
      query: {},
      body: { spec: { entity: 'orders', measures: [{ field: 'ghostField' }] } },
    });

    expect(response.status).toBe(400);
    expect(String((response.body as { error: string }).error)).toMatch(/ghostField/);
  });

  it('runs a valid unsaved spec for the builder’s preview', async () => {
    const { route } = setup();
    const response = await route('POST', '/reports/run').handle({
      actor: OWNER,
      params: {},
      query: {},
      body: { spec: SPEC },
    });

    expect(response.status).toBe(200);
    const body = response.body as { data: { render: { kind: string } } };
    expect(body.data.render.kind).toBe('table');
  });
});

describe('documentShape', () => {
  it('reads the entities a dashboard queries', () => {
    expect(
      documentShape({ kind: 'dashboard', blocks: [{ spec: { entity: 'orders' } }] }),
    ).toEqual({ type: 'dashboard', entity: '', entities: ['orders'] });
  });

  it('maps a malformed stored document to no entities rather than throwing', () => {
    // A legacy or corrupt row must not take the whole list down; it is simply
    // listed for nobody.
    expect(documentShape(null)).toEqual({ type: 'report', entity: '', entities: [] });
    expect(documentShape('nonsense')).toEqual({ type: 'report', entity: '', entities: [] });
  });
});
