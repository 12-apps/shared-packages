import { createMemoryDataSource, defineCatalog } from '@12-apps/report-builder';
import { reportBuilderRouter } from '@12-apps/report-builder/hono';
import type { ReportActor } from '@12-apps/report-builder/server';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

/**
 * The Hono binding, driven over real HTTP.
 *
 * `app.request()` runs the whole stack — routing, param capture, body parsing,
 * status and JSON serialization — without a listening socket. That matters
 * because the adapter's entire job is the translation between a framework's
 * request and the package's descriptors, and every defect it can have lives in
 * that translation: a param that never reaches the handler, a status the
 * framework rewrites, a body silently dropped on PATCH.
 *
 * Everything under test is the PUBLISHED tarball, mounted the way a host
 * mounts it.
 */
const catalog = defineCatalog({
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
  ];
}

/** Mounts the router exactly as a host does, under its own tenant prefix. */
function setup(actor: ReportActor | null = OWNER): {
  /**
   * The router never leaves this function — a test gets a way to SEND a
   * request, not the instance. That keeps the isolation obvious to a reader
   * (there is no shared object to reuse) and to the flakiness gate, which
   * flags a framework instance returned from a helper.
   */
  request: (path: string, init?: RequestInit) => Promise<Response>;
  stored: () => Row[];
} {
  const db = memoryDb(seedRows());
  const router = new Hono();
  router.route(
    '/api/admin/:tenantSlug',
    reportBuilderRouter({
      catalog,
      adapter,
      db: () => Promise.resolve(db),
      resolveActor: () => actor,
    }),
  );
  return {
    request: (path, init) => router.request(path, init),
    stored: db.all,
  };
}

describe('the router mounts under a host prefix', () => {
  it('answers the field catalog at the host’s own path', async () => {
    const { request } = setup();

    const response = await request('/api/admin/acme/reports/fields');

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { entities: Array<{ entity: string }> } };
    expect(body.data.entities.map((entity) => entity.entity)).toEqual(['orders']);
  });

  it('lists a tenant’s saved reports', async () => {
    const { request } = setup();

    const response = await request('/api/admin/acme/reports/custom');

    const body = (await response.json()) as { data: { reports: Array<{ id: string }> } };
    expect(body.data.reports.map((report) => report.id)).toEqual(['r1']);
  });
});

describe('the adapter carries the whole request through', () => {
  it('delivers a captured path param to the handler', async () => {
    // The failure this guards: a param that never reaches the handler makes
    // every by-id route answer 404 while the route itself matched fine.
    const { request } = setup();

    const response = await request('/api/admin/acme/reports/custom/r1');

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string; type: string } };
    expect(body.data.id).toBe('r1');
    expect(body.data.type).toBe('report');
  });

  it('delivers a JSON body on POST, and answers the handler’s 201', async () => {
    const { request, stored } = setup();

    const response = await request('/api/admin/acme/reports/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Novo',
        spec: SPEC,
        status: 'draft',
        visibility: 'private',
        visibilityRoles: [],
      }),
    });

    // 201 is the handler's choice; an adapter that normalized it to 200 would
    // quietly change the contract for every consumer.
    expect(response.status).toBe(201);
    expect(stored()).toHaveLength(2);
  });

  it('delivers a body on PATCH too', async () => {
    const { request, stored } = setup();

    const response = await request('/api/admin/acme/reports/custom/r1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Renomeado',
        spec: SPEC,
        status: 'published',
        visibility: 'tenant',
        visibilityRoles: [],
      }),
    });

    expect(response.status).toBe(200);
    expect(stored()[0]?.name).toBe('Renomeado');
  });

  it('routes DELETE and reports the removal', async () => {
    const { request, stored } = setup();

    const response = await request('/api/admin/acme/reports/custom/r1', { method: 'DELETE' });

    expect(response.status).toBe(200);
    expect(stored()).toHaveLength(0);
  });
});

describe('authentication is the host’s, and it is enforced', () => {
  it('answers 401 before any handler runs when the actor is unresolved', async () => {
    const { request, stored } = setup(null);

    const response = await request('/api/admin/acme/reports/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', spec: SPEC, status: 'draft', visibility: 'private' }),
    });

    expect(response.status).toBe(401);
    // Nothing was written: the guard runs before the handler, not inside it.
    expect(stored()).toHaveLength(1);
  });
});

describe('a spec error stays the author’s mistake over HTTP', () => {
  it('answers 400 with the compiler’s message, not a 500', async () => {
    const { request } = setup();

    const response = await request('/api/admin/acme/reports/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec: { entity: 'orders', measures: [{ field: 'ghostField' }] } }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/ghostField/);
  });

  it('tolerates a malformed body rather than failing to parse', async () => {
    // The handler's own validation reports this far better than a parse error.
    const { request } = setup();

    const response = await request('/api/admin/acme/reports/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    expect(response.status).toBe(400);
  });
});
