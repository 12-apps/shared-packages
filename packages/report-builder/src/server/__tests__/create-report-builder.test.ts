import { PT_BR_REPORT_SERVER_MESSAGES } from '../pt-BR';
import { PT_BR_REPORT_ENGINE_COPY } from '../../pt-BR';
import { describe, expect, it } from 'vitest';

import { defineCatalog } from '../../catalog';
import { createMemoryDataSource } from '../../memory';
import type { ReportWindow } from '../adapter-shared';
import {
  createApiReportBuilder,
  type ReportActor,
  type ReportResponse,
  type ReportRoute,
} from '../create-report-builder';
import type { SystemReportDef } from '../system-reports';
import type { SavedReportDb, SavedReportRecord } from '../saved';

/**
 * The framework-neutral endpoint surface.
 *
 * These are the RULES the routes encode — who may see what, which status a
 * refusal carries, what a write is allowed to take from the caller. The Hono
 * binding and the consumer harness prove the translation to real HTTP; this
 * proves the decisions being translated.
 */

const CATALOG = defineCatalog({
  entities: {
    orders: {
      label: 'Pedidos',
      fields: {
        createdAt: { label: 'Data', type: 'date', role: 'dimension' },
        method: { label: 'Forma', type: 'string', role: 'dimension' },
        totalCents: { label: 'Receita', type: 'money', role: 'measure' },
      },
    },
    losses: {
      label: 'Perdas',
      fields: {
        reason: { label: 'Motivo', type: 'string', role: 'dimension' },
        units: { label: 'Unidades', type: 'number', role: 'measure' },
      },
    },
  },
});

/** One tier per entity, so "narrowed by permission" is observable. */
const ENTITY_PERMISSION = { orders: 'sales:read', losses: 'stock:read' };

const ORDERS_SPEC = {
  entity: 'orders',
  dimensions: [{ field: 'method' }],
  measures: [{ field: 'totalCents' }],
  presentation: { kind: 'table' },
};

const LOSSES_SPEC = {
  entity: 'losses',
  dimensions: [{ field: 'reason' }],
  measures: [{ field: 'units' }],
  presentation: { kind: 'table' },
};

const SYSTEM: SystemReportDef[] = [
  {
    key: 'vendas',
    title: 'Vendas',
    description: 'Receita por forma de pagamento.',
    permission: 'sales:read',
    section: 'orders',
    supportsGrain: false,
    presentation: 'table',
    build: () => ORDERS_SPEC as never,
  },
  {
    key: 'perdas',
    title: 'Perdas',
    description: 'Unidades perdidas por motivo.',
    permission: 'stock:read',
    section: 'inventory',
    supportsGrain: false,
    presentation: 'table',
    build: () => LOSSES_SPEC as never,
  },
];

function actor(overrides: Partial<ReportActor> = {}): ReportActor {
  return {
    clientId: 'tenant-1',
    userId: 'user-1',
    roleIds: [],
    isAdmin: false,
    // `reports:manage` is this PACKAGE's own id, the one authoring is gated on
    // when the host maps no other. Before this it was a `canAuthor` boolean the
    // host computed for itself.
    permissions: ['sales:read', 'stock:read', 'reports:manage'],
    ...overrides,
  };
}

function record(overrides: Partial<SavedReportRecord> = {}): SavedReportRecord {
  return {
    id: 'r1',
    name: 'Publicado',
    description: null,
    spec: ORDERS_SPEC,
    status: 'published',
    visibility: 'tenant',
    visibilityRoles: [],
    defaultRange: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

interface Harness {
  call(
    method: ReportRoute['method'],
    path: string,
    request?: {
      actor?: ReportActor;
      params?: Record<string, string | undefined>;
      query?: Record<string, string | undefined>;
      body?: unknown;
    },
  ): Promise<ReportResponse>;
  stored(): SavedReportRecord[];
  windows(): ReportWindow[];
}

/**
 * Everything is built per test — no shared store, no shared spy list, so a
 * test that writes cannot change what the next one reads.
 *
 * `duplicateName` makes the store raise Prisma's P2002 the way a unique index
 * does: the 409 is a real rule of this surface, and nothing else in the suite
 * could reach it.
 */
function setup(
  options: {
    seed?: SavedReportRecord[];
    duplicateName?: boolean;
    systemReports?: SystemReportDef[];
  } = {},
): Harness {
  const state = { rows: options.seed ?? [record()], next: 1 };
  const seen: ReportWindow[] = [];

  const duplicate = (): Promise<never> =>
    Promise.reject(Object.assign(new Error('duplicate name'), { code: 'P2002' }));

  const db = {
    savedReport: {
      // Tenant scoping is the STORE's, applied in the `where` it builds; every
      // row here belongs to the one tenant under test, so this returns them
      // all rather than re-implementing a filter it is not the subject of.
      findMany: () => Promise.resolve(state.rows.slice()),
      findFirst: ({ where }: { where: { id?: string } }) =>
        Promise.resolve(state.rows.find((row) => row.id === where.id) ?? null),
      create: ({ data }: { data: Record<string, unknown> }) => {
        if (options.duplicateName) return duplicate();
        state.next += 1;
        const created = { ...record(), ...data, id: `r${state.next}` } as SavedReportRecord;
        state.rows = [...state.rows, created];
        return Promise.resolve(created);
      },
      updateMany: ({ where, data }: { where: { id?: string }; data: Record<string, unknown> }) => {
        if (options.duplicateName) return duplicate();
        const match = state.rows.find((row) => row.id === where.id);
        state.rows = state.rows.map((row) =>
          row.id === where.id ? ({ ...row, ...data } as SavedReportRecord) : row,
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

  const { routes } = createApiReportBuilder({
    catalog: CATALOG,
    copy: PT_BR_REPORT_ENGINE_COPY,
    messages: PT_BR_REPORT_SERVER_MESSAGES,
    // A FACTORY, so the window each request resolves is observable: an adapter
    // that never saw the window would silently report on all of history.
    adapter: ({ window }) => {
      seen.push(window);
      return createMemoryDataSource({
        orders: [{ createdAt: new Date('2026-07-14T12:00:00Z'), method: 'PIX', totalCents: 1000 }],
        losses: [{ reason: 'quebra', units: 3 }],
      });
    },
    db: () => Promise.resolve(db),
    timeZone: 'America/Sao_Paulo',
    now: () => new Date('2026-07-14T23:00:00Z'),
    entityPermission: ENTITY_PERMISSION,
    systemReports: options.systemReports ?? SYSTEM,
    // Required, including the empty case — this surface has no defaultable
    // vocabulary field left.
    starters: {},
  });

  return {
    call(method, path, request = {}) {
      const route = routes.find((candidate) => candidate.method === method && candidate.path === path);
      if (!route) throw new Error(`No route for ${method} ${path}`);
      return route.handle({
        actor: request.actor ?? actor(),
        params: request.params ?? {},
        query: request.query ?? {},
        body: request.body,
      });
    },
    stored: () => state.rows,
    windows: () => seen,
  };
}

/** The `{ data }` envelope, unwrapped for readability. */
function data<T>(response: ReportResponse): T {
  return (response.body as { data: T }).data;
}

describe('the field catalog is narrowed to what the actor may query', () => {
  it('lists only the entities the actor’s tier reaches', async () => {
    const { call } = setup();

    const response = await call('GET', '/reports/fields', {
      actor: actor({ permissions: ['sales:read'] }),
    });

    const listing = data<{ entities: Array<{ entity: string }> }>(response);
    expect(listing.entities.map((entity) => entity.entity)).toEqual(['orders']);
  });

  it('refuses outright when the actor reaches nothing', async () => {
    // Not an empty catalog — a caller who may not author reports at all. An
    // empty list would render an entity picker with nothing in it.
    const { call } = setup();

    const response = await call('GET', '/reports/fields', {
      actor: actor({ permissions: [] }),
    });

    expect(response.status).toBe(403);
  });
});

describe('the built-in reports', () => {
  it('lists only the presets the actor may run', async () => {
    const { call } = setup();

    const response = await call('GET', '/reports/system', {
      actor: actor({ permissions: ['stock:read'] }),
    });

    const listing = data<{ reports: Array<{ key: string }> }>(response);
    expect(listing.reports.map((report) => report.key)).toEqual(['perdas']);
  });

  it('refuses when the actor may run none of them', async () => {
    const { call } = setup();

    const response = await call('GET', '/reports/system', {
      actor: actor({ permissions: [] }),
    });

    expect(response.status).toBe(403);
  });

  it('runs one for the requested period and echoes the window', async () => {
    const { call, windows } = setup();

    const response = await call('GET', '/reports/system/:key', {
      params: { key: 'vendas' },
      query: { preset: 'today' },
    });

    expect(response.status).toBe(200);
    const result = data<{ key: string; range: { from: string }; render: { kind: string } }>(
      response,
    );
    expect(result.key).toBe('vendas');
    expect(result.range.from).toBe('2026-07-14T03:00:00.000Z');
    expect(result.render.kind).toBe('table');
    // The adapter was scoped to the same window that was echoed.
    expect(windows()[0]?.from.toISOString()).toBe('2026-07-14T03:00:00.000Z');
  });

  it('answers 404 for a key that does not exist, before any permission check', async () => {
    // A 403 on an unknown key reads as "you nearly had it" — and there is no
    // id here to protect, so absence is the honest answer.
    const { call } = setup();

    const response = await call('GET', '/reports/system/:key', {
      actor: actor({ permissions: [] }),
      params: { key: 'inventado' },
    });

    expect(response.status).toBe(404);
  });

  it('answers 403 for a real key the actor may not run', async () => {
    const { call } = setup();

    const response = await call('GET', '/reports/system/:key', {
      actor: actor({ permissions: ['stock:read'] }),
      params: { key: 'vendas' },
    });

    expect(response.status).toBe(403);
  });

  it('serves no built-ins at all when the host declares none', async () => {
    // The case that used to serve the origin host's seven presets to a silent host.
    // An empty list is now the only thing "I have no built-ins" can mean, and
    // it is an empty LIST rather than a 403: refusing here would say "you may
    // not", when what is true is "there are none".
    const { call } = setup({ systemReports: [] });

    const response = await call('GET', '/reports/system', { actor: actor() });

    expect(response.status).toBe(200);
    expect(data<{ reports: unknown[] }>(response).reports).toEqual([]);
  });
});

describe('listing saved documents narrows twice', () => {
  it('drops documents the lifecycle hides', async () => {
    const { call } = setup({
      seed: [record(), record({ id: 'r2', name: 'Rascunho', status: 'draft', createdBy: 'alguem' })],
    });

    const response = await call('GET', '/reports/custom', {
      actor: actor({ userId: 'user-1', isAdmin: false }),
    });

    const listing = data<{ reports: Array<{ id: string }> }>(response);
    expect(listing.reports.map((report) => report.id)).toEqual(['r1']);
  });

  it('drops documents whose entity the actor may not query', async () => {
    const { call } = setup({
      seed: [record(), record({ id: 'r2', name: 'Perdas', spec: LOSSES_SPEC })],
    });

    const response = await call('GET', '/reports/custom', {
      actor: actor({ permissions: ['sales:read'] }),
    });

    const listing = data<{ reports: Array<{ id: string }> }>(response);
    expect(listing.reports.map((report) => report.id)).toEqual(['r1']);
  });

  it('refuses outright when the actor reaches no entity at all', async () => {
    // Not an empty list. An empty list is a STATEMENT — "you have no saved
    // reports" — and it is the wrong statement to make to someone the feature
    // was never granted to. `/reports/fields` and `/reports/system` both 403
    // here, and the three routes of one area must not disagree about whether
    // that area is visible.
    const { call } = setup();

    const response = await call('GET', '/reports/custom', {
      actor: actor({ permissions: [] }),
    });

    expect(response.status).toBe(403);
  });

  it('drops a document that names no entity at all', async () => {
    // A malformed or legacy value maps to no entity, so it is listed for
    // nobody rather than for everybody.
    const { call } = setup({ seed: [record({ spec: { totally: 'wrong' } })] });

    const response = await call('GET', '/reports/custom');

    expect(data<{ reports: unknown[] }>(response).reports).toEqual([]);
  });
});

describe('opening one saved document', () => {
  it('runs it for the window and echoes both', async () => {
    const { call, windows } = setup();

    const response = await call('GET', '/reports/custom/:id', {
      params: { id: 'r1' },
      query: { preset: 'today' },
    });

    expect(response.status).toBe(200);
    const view = data<{ type: string; range: { from: string }; render: unknown }>(response);
    expect(view.type).toBe('report');
    expect(view.range.from).toBe('2026-07-14T03:00:00.000Z');
    expect(windows()[0]?.toExclusive.toISOString()).toBe('2026-07-15T03:00:00.000Z');
  });

  it('answers 404 — not 403 — for a document the actor may not see', async () => {
    // 403 confirms the id exists, which is itself a disclosure on a tenant
    // surface: an outsider could enumerate ids by the status they get back.
    const { call } = setup({ seed: [record({ status: 'draft', createdBy: 'alguem' })] });

    const response = await call('GET', '/reports/custom/:id', {
      params: { id: 'r1' },
      actor: actor({ isAdmin: false }),
    });

    expect(response.status).toBe(404);
  });

  it('refuses a visible document whose entity the actor may not query', async () => {
    const { call } = setup({ seed: [record({ spec: LOSSES_SPEC })] });

    const response = await call('GET', '/reports/custom/:id', {
      params: { id: 'r1' },
      actor: actor({ permissions: ['sales:read'] }),
    });

    expect(response.status).toBe(403);
  });

  it('renders a dashboard block-by-block, each with its sentence', async () => {
    const { call } = setup({
      seed: [
        record({
          spec: {
            kind: 'dashboard',
            blocks: [{ id: 'b1', span: 6, spec: ORDERS_SPEC }],
          },
        }),
      ],
    });

    const response = await call('GET', '/reports/custom/:id', { params: { id: 'r1' } });

    const view = data<{
      type: string;
      blocks: Array<{ id: string; status: string; sentence?: string }>;
    }>(response);
    expect(view.type).toBe('dashboard');
    expect(view.blocks[0]?.status).toBe('ok');
    // The sentence is computed server-side so the viewer, the editor and an
    // export cannot drift; it reaching the wire is the half that was missing.
    expect(view.blocks[0]?.sentence).toBeTruthy();
  });

  it('folds catalog drift on a stored spec into a 400', async () => {
    // The entity still resolves — a field it groups by does not. This is what
    // catalog drift actually looks like on a document saved months ago, and
    // the compiler's message is what tells the author which field to fix.
    const { call } = setup({
      seed: [record({ spec: { ...ORDERS_SPEC, measures: [{ field: 'fantasma' }] } })],
    });

    const response = await call('GET', '/reports/custom/:id', { params: { id: 'r1' } });

    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toMatch(/fantasma/);
  });

  it('refuses a stored spec whose ENTITY is outside the permission map', async () => {
    // Fail closed: an entity nobody was granted is an entity nobody may read,
    // and that check runs before the document is ever parsed — authorization
    // does not wait on validation.
    const { call } = setup({ seed: [record({ spec: { ...ORDERS_SPEC, entity: 'fantasma' } })] });

    const response = await call('GET', '/reports/custom/:id', { params: { id: 'r1' } });

    expect(response.status).toBe(403);
  });
});

describe('writing a saved document', () => {
  const body = {
    name: 'Novo',
    spec: ORDERS_SPEC,
    status: 'draft',
    visibility: 'private',
    visibilityRoles: [],
  };

  it('takes authorship from the actor, never from the body', async () => {
    // A client that could name its own `createdBy` could author as someone
    // else — and authorship is what `visibility: 'private'` is judged on.
    const { call, stored } = setup({ seed: [] });

    await call('POST', '/reports/custom', {
      actor: actor({ userId: 'real-user' }),
      body: { ...body, createdBy: 'someone-else' },
    });

    expect(stored()[0]?.createdBy).toBe('real-user');
  });

  it('answers 200 with the summary the picker lists', async () => {
    const { call } = setup({ seed: [] });

    const response = await call('POST', '/reports/custom', { body });

    expect(response.status).toBe(200);
    expect(data<{ type: string; entities: string[] }>(response)).toMatchObject({
      type: 'report',
      entities: ['orders'],
    });
  });

  it('refuses an actor who may not author', async () => {
    const { call, stored } = setup({ seed: [] });

    const response = await call('POST', '/reports/custom', {
      actor: actor({ permissions: ['sales:read', 'stock:read'] }),
      body,
    });

    expect(response.status).toBe(403);
    expect(stored()).toHaveLength(0);
  });

  it('rejects a spec that does not compile, before touching the database', async () => {
    const { call, stored } = setup({ seed: [] });

    const response = await call('POST', '/reports/custom', {
      body: { ...body, spec: { ...ORDERS_SPEC, measures: [{ field: 'inexistente' }] } },
    });

    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toMatch(/inexistente/);
    expect(stored()).toHaveLength(0);
  });

  it('names the failing BLOCK when a dashboard does not compile', async () => {
    const { call } = setup({ seed: [] });

    const response = await call('POST', '/reports/custom', {
      body: {
        ...body,
        spec: {
          kind: 'dashboard',
          blocks: [
            { id: 'ok', span: 6, spec: ORDERS_SPEC },
            { id: 'quebrado', span: 6, spec: { ...ORDERS_SPEC, entity: 'fantasma' } },
          ],
        },
      },
    });

    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toMatch(/blocks\[1\].*quebrado/);
  });

  it('turns a duplicate name into a 409, not a 500', async () => {
    const { call } = setup({ seed: [], duplicateName: true });

    const response = await call('POST', '/reports/custom', { body });

    expect(response.status).toBe(409);
  });
});

describe('updating a saved document', () => {
  const full = {
    name: 'Renomeado',
    spec: ORDERS_SPEC,
    status: 'published',
    visibility: 'tenant',
    visibilityRoles: [],
  };

  it('is a PUT, the method the client has always sent', async () => {
    const { call, stored } = setup();

    const response = await call('PUT', '/reports/custom/:id', {
      params: { id: 'r1' },
      body: full,
    });

    expect(response.status).toBe(200);
    expect(stored()[0]?.name).toBe('Renomeado');
  });

  it('KEEPS lifecycle fields the body omitted', async () => {
    // An MCP author updating only the spec must not accidentally publish a
    // draft or reset its sharing.
    const { call, stored } = setup({
      seed: [record({ status: 'draft', visibility: 'roles', visibilityRoles: ['role-a'] })],
    });

    await call('PUT', '/reports/custom/:id', {
      params: { id: 'r1' },
      body: { name: 'Só o nome', spec: ORDERS_SPEC },
    });

    expect(stored()[0]).toMatchObject({
      status: 'draft',
      visibility: 'roles',
      visibilityRoles: ['role-a'],
    });
  });

  it('answers 404 for an id outside this tenant', async () => {
    const { call } = setup();

    const response = await call('PUT', '/reports/custom/:id', {
      params: { id: 'nao-existe' },
      body: full,
    });

    expect(response.status).toBe(404);
  });
});

describe('deleting a saved document', () => {
  it('answers 204 with NO body', async () => {
    const { call, stored } = setup();

    const response = await call('DELETE', '/reports/custom/:id', { params: { id: 'r1' } });

    expect(response.status).toBe(204);
    expect(response.body).toBeUndefined();
    expect(stored()).toHaveLength(0);
  });

  it('answers 404 when nothing matched', async () => {
    const { call } = setup();

    const response = await call('DELETE', '/reports/custom/:id', { params: { id: 'outro' } });

    expect(response.status).toBe(404);
  });
});

describe('the dry run', () => {
  it('runs an unsaved spec over the period named in the body', async () => {
    const { call, windows } = setup();

    const response = await call('POST', '/reports/run', {
      body: { spec: ORDERS_SPEC, preset: 'today' },
    });

    expect(response.status).toBe(200);
    expect(data<{ range: { from: string } }>(response).range.from).toBe(
      '2026-07-14T03:00:00.000Z',
    );
    expect(windows()[0]?.from.toISOString()).toBe('2026-07-14T03:00:00.000Z');
  });

  it('checks the entity BEFORE the spec reaches the adapter', async () => {
    // A spec is the caller's own text; this check is the only thing between it
    // and a table.
    const { call, windows } = setup();

    const response = await call('POST', '/reports/run', {
      actor: actor({ permissions: ['sales:read'] }),
      body: { spec: LOSSES_SPEC },
    });

    expect(response.status).toBe(403);
    expect(windows()).toHaveLength(0);
  });

  it('answers 400 — not 500 — for a body that is not a spec at all', async () => {
    const { call } = setup();

    const response = await call('POST', '/reports/run', { body: undefined });

    expect(response.status).toBe(400);
  });

  it('carries the compiler’s message so an author can self-correct', async () => {
    const { call } = setup();

    const response = await call('POST', '/reports/run', {
      body: { spec: { ...ORDERS_SPEC, measures: [{ field: 'fantasma' }] } },
    });

    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toMatch(/fantasma/);
  });
});
