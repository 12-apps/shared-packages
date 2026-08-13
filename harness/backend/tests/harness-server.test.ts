/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   the filesystem and the database ARE the subject. This drives the harness's
   own server, whose whole point is that the reports endpoints run over a real
   Postgres created by the PACKAGE'S migrations read out of the installed
   tarball; mocking either would leave the suite checking a stand-in, which is
   precisely the arrangement this server was built to replace. Every path read
   is inside the installed package and the database is a fresh in-process
   PGlite per suite. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { NOW } from '../src/fixtures/report-fixture-window';

/**
 * The harness backend, driven through the app the browser drives.
 *
 * `harness/frontend`'s Playwright suite proves the same thing from the other
 * end, in a browser, over a socket. This is the half that can say WHY when
 * that one goes red: the app is built separately from the listener precisely
 * so `app.request()` and a socket reach the same handlers, and a Save that
 * 500s here is a wiring fault rather than a UI one.
 *
 * The two properties asserted below are the ones the whole Playwright suite
 * silently rests on, and neither is visible from inside a spec:
 *
 *  - the clock is FROZEN, so a rolling window means the same thing on every
 *    machine and in six months' time;
 *  - `/__harness/reset` really returns the store to the seeded fixture, so one
 *    case's writes cannot reach the next one — or the next RUN.
 */
const TENANT = '/api/admin/harness';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
});

afterAll(async () => {
  await backend.close();
});

/** The saved-report summaries, as the list screen reads them. */
async function listNames(): Promise<string[]> {
  const response = await backend.app.request(`${TENANT}/reports/custom`);
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { data: { reports: Array<{ name: string }> } };
  return payload.data.reports.map((report) => report.name);
}

/** A minimal publishable document — one table block over the seeded orders. */
function document(name: string): Record<string, unknown> {
  return {
    name,
    spec: {
      kind: 'dashboard',
      blocks: [
        {
          id: 'b1',
          span: 12,
          title: name,
          spec: {
            entity: 'orders',
            dimensions: [{ field: 'method' }],
            measures: [{ field: 'revenueCents' }],
            presentation: { kind: 'table' },
          },
        },
      ],
    },
    status: 'published',
    visibility: 'tenant',
    visibilityRoles: [],
  };
}

async function create(name: string): Promise<Response> {
  return backend.app.request(`${TENANT}/reports/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(document(name)),
  });
}

describe('the harness backend serves the package over a real Postgres', () => {
  it('is not ready until the fixture is seeded', async () => {
    // What Playwright's `webServer` waits on. It answers only after six
    // migrations and the seed, so the first spec cannot race the first
    // migration — which would surface as "relation saved_reports does not
    // exist" and read like a broken package.
    const health = await backend.app.request('/health');

    expect(health.status).toBe(200);
    expect(await listNames()).toContain('Vendas por forma de pagamento');
  });

  it('answers the roles picker in ITS envelope, not the reports one', async () => {
    // This endpoint stopped being a host stub in 12-13: it is now the REAL
    // @12-apps/rbac catalog, seeded. What the reports picker depends on is the
    // envelope — `{ data, pagination.hasNextPage }`, not the reports `{ data }`
    // one, because its paging loop reads `hasNextPage` and never terminates
    // off `undefined`.
    const roles = await backend.app.request(`${TENANT}/roles`);
    const page = (await roles.json()) as {
      data: { name: string }[];
      pagination: { hasNextPage: boolean };
    };

    expect(roles.status).toBe(200);
    expect(page.pagination.hasNextPage).toBe(false);
    expect(page.data.map((row) => row.name)).toContain('Voluntário');
  });

  it('keeps a created document, and stamps it from the FROZEN clock', async () => {
    const saved = await create('Persistência');
    expect(saved.status).toBe(200);

    // The write survives the request that made it — the whole difference
    // between this and the closure over an array it replaced.
    expect(await listNames()).toContain('Persistência');

    // …and is dated by the clock the router resolves windows against, not by
    // the machine's. A report saved during a run that reads "há 2 min" against
    // a different today than every window on the screen beside it is the bug
    // this forecloses.
    const created = (await saved.json()) as { data: { updatedAt: string } };
    expect(created.data.updatedAt).toBe(NOW.toISOString());
  });

  it('reports a duplicate name as a field error rather than a 500', async () => {
    // Postgres raises 23505 where Prisma raises P2002, and the package looks
    // for P2002. Untranslated, "já existe um relatório com esse nome" reaches
    // the author as a crash.
    const collision = await create('Persistência');

    expect(collision.status).toBe(409);
    expect(await listNames()).toEqual(expect.arrayContaining(['Persistência']));
  });

  it('returns the store to the fixture on reset', async () => {
    const reset = await backend.app.request('/__harness/reset', { method: 'POST' });
    expect(reset.status).toBe(204);

    // Exactly the seven seeded cards: the document created above is gone, and
    // nothing seeded is missing. A reset that merely re-inserted the fixture
    // would leave the extra one behind, and the Playwright suite would start
    // passing once and failing forever.
    expect(await listNames()).toEqual([
      'Cardápio antigo',
      'Fechamento do caixa',
      'Metas da equipe',
      'Movimento por hora',
      'Perdas por motivo',
      'Ticket médio',
      'Vendas por forma de pagamento',
    ]);
  });
});
