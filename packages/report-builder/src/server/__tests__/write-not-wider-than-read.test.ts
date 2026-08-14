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
 * THE WRITE SURFACE IS NEVER WIDER THAN THE READ SURFACE.
 *
 * `GET /reports/custom/:id` refuses a document the actor may not see, and
 * refuses it with a 404 rather than a 403 so the id's existence is not
 * confirmed. Every write on an EXISTING document has to answer the same way,
 * and until this suite existed none of them did: they asked `mayAuthor` and
 * nothing else.
 *
 * That was inert for exactly as long as authoring was a role tier. Hosts
 * computed `canAuthor` from their admin roles, `canViewSavedReport`
 * short-circuits on `isAdmin`, so "may author" implied "sees everything" —
 * by coincidence, not by rule. Authoring is `reports:manage` now: a class
 * permission a store can grant to a member who is not an admin, which is
 * precisely what this package tells adopters they may do. The first store that
 * does it hands that member overwrite, re-share and DELETE over every saved
 * document in the tenant, private drafts included — documents whose `GET`
 * answers them 404.
 *
 * So each case here pairs the write with the read of the same document by the
 * same actor. The read's answer is the specification; the write's answer must
 * match it.
 */

const LENDING = 'library:lending:read';
/** This package's own contributed id — the one authoring rides by default. */
const MANAGE = 'reports:manage';

const CATALOG = defineCatalog({
  entities: {
    loans: {
      label: 'Empréstimos',
      fields: {
        borrowedAt: { label: 'Data de empréstimo', type: 'date', role: 'dimension' },
        shelfCode: { label: 'Estante', type: 'string', role: 'dimension' },
        loanDays: { label: 'Dias emprestado', type: 'number', role: 'measure' },
      },
    },
  },
});

const SPEC = {
  entity: 'loans',
  dimensions: [{ field: 'shelfCode' }],
  measures: [{ field: 'loanDays' }],
  filters: [],
  sort: [],
  presentation: { kind: 'table' },
};

/** The edit a write would land, told apart from {@link SPEC} by its grouping. */
const EDITED_SPEC = { ...SPEC, dimensions: [{ field: 'borrowedAt' }] };

const AUTHOR_ID = 'bibliotecaria';
/** A colleague who holds the authoring permission and authored nothing. */
const COLLEAGUE_ID = 'colega';

/**
 * The document at the centre of every case: PUBLISHED (so the working-copy
 * routes get past their own lifecycle gate and the visibility check is the only
 * thing left that can refuse them) and PRIVATE to its author.
 */
function privateReport(overrides: Partial<SavedReportRecord> = {}): SavedReportRecord {
  return {
    id: 'rel-1',
    name: 'Circulação da semana',
    description: null,
    spec: SPEC,
    status: 'published',
    visibility: 'private',
    visibilityRoles: [],
    defaultRange: null,
    workingCopy: null,
    createdBy: AUTHOR_ID,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function actor(userId: string): ReportActor {
  return {
    clientId: 'tenant-lisboa',
    userId,
    roleIds: [],
    // NOT an admin. An admin sees every document in the tenant, which is what
    // made the missing check invisible for as long as authoring was a role.
    isAdmin: false,
    permissions: [LENDING, MANAGE],
  };
}

interface Harness {
  call(
    method: ReportRoute['method'],
    path: string,
    request?: { actor?: ReportActor; body?: unknown },
  ): Promise<ReportResponse>;
  /** The stored row, or `undefined` once something has deleted it. */
  row(): SavedReportRecord | undefined;
}

/** Built per test — no shared store, so one case's write cannot reach another. */
function setup(seed: SavedReportRecord = privateReport()): Harness {
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
      // A REAL delete, so "the write was refused" and "the row is still there"
      // are two independent observations rather than one restated.
      deleteMany: ({ where }: { where: { id?: string } }) => {
        const before = state.rows.length;
        state.rows = state.rows.filter((row) => row.id !== where.id);
        return Promise.resolve({ count: before - state.rows.length });
      },
    },
  } as unknown as SavedReportDb;

  const { routes } = createApiReportBuilder({
    catalog: CATALOG,
    adapter: () => createMemoryDataSource({ loans: [] }),
    db: () => Promise.resolve(db),
    entityPermission: { loans: LENDING },
    systemReports: [],
    starters: {},
    timeZone: 'Europe/Lisbon',
    now: () => new Date('2026-07-14T12:00:00Z'),
  });

  return {
    call(method, path, request = {}) {
      const route = routes.find(
        (candidate) => candidate.method === method && candidate.path === path,
      );
      if (!route) throw new Error(`No route for ${method} ${path}`);
      return route.handle({
        actor: request.actor ?? actor(COLLEAGUE_ID),
        params: { id: 'rel-1' },
        query: {},
        body: request.body,
      });
    },
    row: () => state.rows[0],
  };
}

const DOCUMENT = '/reports/custom/:id';
const PARK = '/reports/custom/:id/working-copy';
const PUBLISH = '/reports/custom/:id/working-copy/publish';

/** A body every write on this surface accepts, so only authorization decides. */
const SAVE_BODY = { name: 'Circulação da semana', spec: EDITED_SPEC };

/**
 * Each write, named with the arguments that reach it. One table, because the
 * property under test is that they all agree — asserting it route by route in
 * prose is how five of the six came to disagree with the sixth in the first
 * place.
 */
const WRITES: Array<{
  what: string;
  method: ReportRoute['method'];
  path: string;
  body?: unknown;
}> = [
  { what: 'PUT the document', method: 'PUT', path: DOCUMENT, body: SAVE_BODY },
  { what: 'DELETE the document', method: 'DELETE', path: DOCUMENT },
  { what: 'park a working copy', method: 'PUT', path: PARK, body: SAVE_BODY },
  { what: 'publish the working copy', method: 'POST', path: PUBLISH, body: SAVE_BODY },
  { what: 'discard the working copy', method: 'DELETE', path: PARK },
];

/** Send every write above at one harness, in order, and read back the row. */
async function afterEveryWrite(harness: Harness): Promise<SavedReportRecord | undefined> {
  for (const write of WRITES) {
    await harness.call(write.method, write.path, { body: write.body });
  }
  return harness.row();
}

describe('a private report is invisible to the read surface', () => {
  it('404s the colleague who holds reports:manage but did not author it', async () => {
    const harness = setup();

    const response = await harness.call('GET', DOCUMENT);

    // The specification every case below is measured against.
    expect(response.status).toBe(404);
  });

  it('leaves it off that colleague’s list', async () => {
    const harness = setup();

    const listed = (
      (await harness.call('GET', '/reports/custom')).body as {
        data: { reports: Array<{ id: string }> };
      }
    ).data.reports;

    expect(listed).toEqual([]);
  });
});

describe('every write refuses it the same way', () => {
  it.each(WRITES)('$what → 404, not a success', async ({ method, path, body }) => {
    const refused = setup(privateReport({ workingCopy: { name: 'Rascunho', spec: EDITED_SPEC } }));

    const response = await refused.call(method, path, { body });

    // 404 and not 403: a 403 would confirm the id exists, which is the
    // disclosure the read side goes out of its way not to make.
    expect(response.status).toBe(404);
  });

  it('leaves the document exactly as it was', async () => {
    const stored = await afterEveryWrite(setup());

    // Still there — the DELETE case is the one where a refusal that only
    // changed the status code would still have destroyed the row.
    expect(stored).toBeDefined();
    expect(stored?.spec).toEqual(SPEC);
    expect(stored?.workingCopy ?? null).toBeNull();
    // `PUT /reports/custom/:id` can rewrite `status` and `visibility` too, so a
    // fail-open there is also a re-share of somebody else's private document.
    expect(stored?.visibility).toBe('private');
    expect(stored?.status).toBe('published');
  });

  /**
   * A draft is author-only WHATEVER its visibility, which is a different clause
   * of `canViewSavedReport` — and the one an `archived` document also lands on.
   */
  it('applies to a tenant-visible DRAFT the colleague did not author', async () => {
    const harness = setup(privateReport({ status: 'draft', visibility: 'tenant' }));

    expect((await harness.call('GET', DOCUMENT)).status).toBe(404);
    expect((await harness.call('PUT', DOCUMENT, { body: SAVE_BODY })).status).toBe(404);
    expect((await harness.call('DELETE', DOCUMENT)).status).toBe(404);
    expect(harness.row()).toBeDefined();
  });
});

/**
 * The other half, and the reason this cannot be implemented as "authors only".
 * Narrowing the write surface to the read surface must leave every legitimate
 * write exactly where it was — a suite that only proved refusals would pass
 * just as well against a package that refused everything.
 */
describe('the reader who may see it can still write it', () => {
  it.each(WRITES)('$what → its ordinary success', async ({ method, path, body }) => {
    const allowed = setup(privateReport({ workingCopy: { name: 'Rascunho', spec: EDITED_SPEC } }));

    const response = await allowed.call(method, path, { actor: actor(AUTHOR_ID), body });

    // 204 is DELETE's success; everything else answers 200.
    expect([200, 204]).toContain(response.status);
  });

  it('admits an admin who authored nothing, because the read side does', async () => {
    const harness = setup();
    const admin: ReportActor = { ...actor('platform-admin'), isAdmin: true };

    expect((await harness.call('GET', DOCUMENT, { actor: admin })).status).toBe(200);
    expect(
      (await harness.call('PUT', DOCUMENT, { actor: admin, body: SAVE_BODY })).status,
    ).toBe(200);
  });

  /**
   * Authoring is still a separate question from visibility: a tenant-wide
   * report is readable by everyone who reaches its entity, and writing it is
   * still 403 without `reports:manage`. Narrowing writes to the read surface
   * must not quietly widen them to it.
   */
  it('still answers 403 to a reader without reports:manage', async () => {
    const harness = setup(privateReport({ visibility: 'tenant' }));
    const reader: ReportActor = { ...actor(COLLEAGUE_ID), permissions: [LENDING] };

    expect((await harness.call('GET', DOCUMENT, { actor: reader })).status).toBe(200);
    expect(
      (await harness.call('PUT', DOCUMENT, { actor: reader, body: SAVE_BODY })).status,
    ).toBe(403);
    expect((await harness.call('DELETE', DOCUMENT, { actor: reader })).status).toBe(403);
  });
});
