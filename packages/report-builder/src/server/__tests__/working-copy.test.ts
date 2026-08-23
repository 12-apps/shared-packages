import { PT_BR_REPORT_ENGINE_COPY } from '../../pt-BR';
import { PT_BR_REPORT_SERVER_MESSAGES } from '../../server/pt-BR';
import { describe, expect, it } from 'vitest';

import { defineCatalog } from '../../catalog';
import { createMemoryDataSource } from '../../memory';
import {
  createApiReportBuilder,
  type ReportActor,
  type ReportResponse,
  type ReportRoute,
} from '../create-report-builder';
import type { SavedReportDb, SavedReportRecord } from '../saved';

/**
 * Unpublished changes to a PUBLISHED report (FUT-755).
 *
 * What these cases pin is the promise each of the three endpoints makes about
 * the LIVE document, because that promise is the whole feature:
 *
 *  - parking writes `working_copy` and does not touch `spec` — a reader loading
 *    the report while someone edits it gets the published version;
 *  - publishing writes `spec` and clears `working_copy` in ONE write;
 *  - discarding clears `working_copy` and, again, never touches `spec`.
 *
 * Plus the judgement call that is invisible from the outside: parking does NOT
 * compile the spec against the field catalog. An autosave fires mid-edit, and
 * mid-edit a block legitimately names a field nobody has chosen yet. A parking
 * endpoint that refused it would drop exactly the work it exists to keep.
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
  },
});

const ENTITY_PERMISSION = { orders: 'sales:read' };

const PUBLISHED_SPEC = {
  entity: 'orders',
  dimensions: [{ field: 'method' }],
  measures: [{ field: 'totalCents' }],
  filters: [],
  sort: [],
  presentation: { kind: 'table' },
};

/** The edit in progress: the same document grouped by day instead. */
const EDITED_SPEC = { ...PUBLISHED_SPEC, dimensions: [{ field: 'createdAt' }] };

/** What a half-configured block looks like: a field the catalog has never heard of. */
const MID_EDIT_SPEC = { ...PUBLISHED_SPEC, dimensions: [{ field: 'aindaNaoEscolhido' }] };

const WORKING_COPY = { name: 'Vendas', spec: EDITED_SPEC, status: 'published' };

function actor(overrides: Partial<ReportActor> = {}): ReportActor {
  return {
    clientId: 'tenant-1',
    userId: 'user-1',
    roleIds: [],
    isAdmin: false,
    // Authoring rides `reports:manage`, this package's own contributed id, in
    // place of the `canAuthor` boolean each host used to compute for itself.
    permissions: ['sales:read', 'reports:manage'],
    ...overrides,
  };
}

function record(overrides: Partial<SavedReportRecord> = {}): SavedReportRecord {
  return {
    id: 'r1',
    name: 'Vendas',
    description: null,
    spec: PUBLISHED_SPEC,
    status: 'published',
    visibility: 'tenant',
    visibilityRoles: [],
    defaultRange: null,
    workingCopy: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
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
      body?: unknown;
    },
  ): Promise<ReportResponse>;
  row(): SavedReportRecord;
}

/** Built per test — no shared store, so a write cannot leak into the next case. */
function setup(seed: SavedReportRecord = record()): Harness {
  const state = { rows: [seed] };

  const db = {
    savedReport: {
      findMany: () => Promise.resolve(state.rows.slice()),
      findFirst: ({ where }: { where: { id?: string } }) =>
        Promise.resolve(state.rows.find((row) => row.id === where.id) ?? null),
      create: () => Promise.reject(new Error('not used here')),
      updateMany: ({ where, data }: { where: { id?: string }; data: Record<string, unknown> }) => {
        const match = state.rows.find((row) => row.id === where.id);
        state.rows = state.rows.map((row) =>
          row.id === where.id ? ({ ...row, ...data } as SavedReportRecord) : row,
        );
        return Promise.resolve({ count: match ? 1 : 0 });
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
    entityPermission: ENTITY_PERMISSION,
    systemReports: [],
    starters: {},
    timeZone: 'America/Sao_Paulo',
    now: () => new Date('2026-08-10T12:00:00Z'),
  });

  return {
    call(method, path, request = {}) {
      const route = routes.find(
        (candidate) => candidate.method === method && candidate.path === path,
      );
      if (!route) throw new Error(`No route for ${method} ${path}`);
      return route.handle({
        actor: request.actor ?? actor(),
        params: request.params ?? { id: 'r1' },
        query: {},
        body: request.body,
      });
    },
    row: () => state.rows[0] as SavedReportRecord,
  };
}

const PARK = '/reports/custom/:id/working-copy';
const PUBLISH = '/reports/custom/:id/working-copy/publish';

function data<T>(response: ReportResponse): T {
  return (response.body as { data: T }).data;
}

/**
 * Which document a spec IS, told apart by the one field the published and the
 * edited version disagree on.
 *
 * Not a whole-object compare: a spec that has been through the wire schema
 * carries defaults the seeded literal does not (`version`), so `toEqual`
 * against the fixture would fail on a difference that is not the subject.
 */
function groupedBy(spec: unknown): string | undefined {
  const dimensions = (spec as { dimensions?: Array<{ field?: string }> }).dimensions ?? [];
  return dimensions[0]?.field;
}

describe('parking an edit beside a published report', () => {
  it('stores the edit and leaves the published document alone', async () => {
    const harness = setup();

    const response = await harness.call('PUT', PARK, { body: WORKING_COPY });

    expect(response.status).toBe(200);
    // The whole promise of the feature, in one assertion: readers are still on
    // the version that was published.
    expect(harness.row().spec).toEqual(PUBLISHED_SPEC);
    expect(harness.row().workingCopy).toMatchObject({ spec: EDITED_SPEC });
  });

  /**
   * The judgement call. A spec naming a field the catalog does not have is what
   * a block looks like halfway through being configured; refusing to park it
   * would mean the work most at risk is the work never stored.
   */
  it('accepts a spec that would not compile, because a mid-edit spec does not', async () => {
    const harness = setup();

    const response = await harness.call('PUT', PARK, {
      body: { name: 'Vendas', spec: MID_EDIT_SPEC },
    });

    expect(response.status).toBe(200);
    expect(harness.row().workingCopy).toMatchObject({ spec: MID_EDIT_SPEC });
  });

  /** Names get selected and retyped; an autosave in that gap must still land. */
  it('accepts an empty name, which publishing will not', async () => {
    const harness = setup();

    const parked = await harness.call('PUT', PARK, { body: { name: '', spec: EDITED_SPEC } });
    const published = await harness.call('POST', PUBLISH, {
      body: { name: '  ', spec: EDITED_SPEC },
    });

    expect(parked.status).toBe(200);
    expect(published.status).toBe(400);
    expect(harness.row().spec).toEqual(PUBLISHED_SPEC);
  });

  /**
   * A never-published report has no reader to protect, so its edits are written
   * straight through by the ordinary save. Answering 200 here would give the
   * editor two ways to save a draft and one of them would be a no-op.
   */
  it('refuses on a report that was never published', async () => {
    const harness = setup(record({ status: 'draft' }));

    const response = await harness.call('PUT', PARK, { body: WORKING_COPY });

    expect(response.status).toBe(400);
    expect(harness.row().workingCopy).toBeNull();
  });

  it('refuses a caller who may not author', async () => {
    const harness = setup();

    const response = await harness.call('PUT', PARK, {
      actor: actor({ permissions: ['sales:read'] }),
      body: WORKING_COPY,
    });

    expect(response.status).toBe(403);
    expect(harness.row().workingCopy).toBeNull();
  });

  it('is a 404 for an id outside the tenant', async () => {
    const harness = setup();

    const response = await harness.call('PUT', PARK, {
      params: { id: 'someone-elses' },
      body: WORKING_COPY,
    });

    expect(response.status).toBe(404);
  });
});

describe('publishing the edit', () => {
  it('makes it live and drops the parked copy in one write', async () => {
    const harness = setup(record({ workingCopy: WORKING_COPY }));

    const response = await harness.call('POST', PUBLISH, {
      body: { name: 'Vendas por dia', spec: EDITED_SPEC },
    });

    expect(response.status).toBe(200);
    expect(groupedBy(harness.row().spec)).toBe('createdAt');
    expect(harness.row().name).toBe('Vendas por dia');
    // Left behind, this would make the report advertise unpublished changes
    // that are byte-for-byte what it already shows.
    expect(harness.row().workingCopy).toBeNull();
  });

  /** Going live is where the catalog check belongs — before any reader sees it. */
  it('refuses a spec the catalog cannot compile', async () => {
    const harness = setup(record({ workingCopy: WORKING_COPY }));

    const response = await harness.call('POST', PUBLISH, {
      body: { name: 'Vendas', spec: MID_EDIT_SPEC },
    });

    expect(response.status).toBe(400);
    expect(harness.row().spec).toEqual(PUBLISHED_SPEC);
    expect(harness.row().workingCopy).toMatchObject({ spec: EDITED_SPEC });
  });

  it('keeps the stored sharing rule when the body does not name one', async () => {
    const harness = setup(record({ visibility: 'private', workingCopy: WORKING_COPY }));

    await harness.call('POST', PUBLISH, { body: { name: 'Vendas', spec: EDITED_SPEC } });

    expect(harness.row().visibility).toBe('private');
  });

  it('refuses a caller who may not author', async () => {
    const harness = setup(record({ workingCopy: WORKING_COPY }));

    const response = await harness.call('POST', PUBLISH, {
      actor: actor({ permissions: ['sales:read'] }),
      body: { name: 'Vendas', spec: EDITED_SPEC },
    });

    expect(response.status).toBe(403);
    expect(harness.row().spec).toEqual(PUBLISHED_SPEC);
  });
});

describe('discarding the edit', () => {
  it('drops it and leaves the published document exactly as it was', async () => {
    const harness = setup(record({ workingCopy: WORKING_COPY }));

    const response = await harness.call('DELETE', PARK);

    expect(response.status).toBe(200);
    expect(harness.row().workingCopy).toBeNull();
    expect(harness.row().spec).toEqual(PUBLISHED_SPEC);
  });

  /**
   * A 200 on nothing would tell the editor to reset to a published version it
   * is already showing, hiding the fact that the parked edit is still there.
   */
  it('is a 404 when there is nothing parked', async () => {
    const harness = setup();

    const response = await harness.call('DELETE', PARK);

    expect(response.status).toBe(404);
  });

  it('refuses a caller who may not author', async () => {
    const harness = setup(record({ workingCopy: WORKING_COPY }));

    const response = await harness.call('DELETE', PARK, { actor: actor({ permissions: ['sales:read'] }) });

    expect(response.status).toBe(403);
    expect(harness.row().workingCopy).toMatchObject({ spec: EDITED_SPEC });
  });
});

describe('what the rest of the surface says about a parked edit', () => {
  /** Reopening the editor resumes the edit — the point of storing it. */
  it('hands the parked edit to an author who opens the report', async () => {
    const harness = setup(record({ workingCopy: WORKING_COPY }));

    const response = await harness.call('GET', '/reports/custom/:id');

    const view = data<{ spec: unknown; workingCopy: { spec: unknown } | null }>(response);
    // The document itself is still the PUBLISHED one; the edit rides beside it.
    expect(groupedBy(view.spec)).toBe('method');
    expect(groupedBy(view.workingCopy?.spec)).toBe('createdAt');
  });

  it('withholds it from a reader who cannot author', async () => {
    const harness = setup(record({ workingCopy: WORKING_COPY }));

    const response = await harness.call('GET', '/reports/custom/:id', {
      actor: actor({ permissions: ['sales:read'] }),
    });

    const view = data<{ spec: unknown; workingCopy: unknown }>(response);
    expect(view.workingCopy).toBeNull();
    expect(groupedBy(view.spec)).toBe('method');
  });

  /** What puts the chip on the list card without opening the report. */
  it('flags the report in the listing', async () => {
    const harness = setup(record({ workingCopy: WORKING_COPY }));

    const listed = data<{ reports: Array<{ hasUnpublishedChanges: boolean }> }>(
      await harness.call('GET', '/reports/custom'),
    );
    expect(listed.reports[0]?.hasUnpublishedChanges).toBe(true);

    await harness.call('DELETE', PARK);
    const after = data<{ reports: Array<{ hasUnpublishedChanges: boolean }> }>(
      await harness.call('GET', '/reports/custom'),
    );
    expect(after.reports[0]?.hasUnpublishedChanges).toBe(false);
  });

  /**
   * Archiving re-sends the document with only `status` changed. It must not
   * destroy work its author has not looked at since — which is why the ordinary
   * save leaves the column alone rather than clearing it "for tidiness".
   */
  it('survives an ordinary save that was not about the edit at all', async () => {
    const harness = setup(record({ workingCopy: WORKING_COPY }));

    const response = await harness.call('PUT', '/reports/custom/:id', {
      body: { name: 'Vendas', spec: PUBLISHED_SPEC, status: 'archived' },
    });

    expect(response.status).toBe(200);
    expect(harness.row().status).toBe('archived');
    expect(harness.row().workingCopy).toMatchObject({ spec: EDITED_SPEC });
  });
});
