/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   the database IS the subject: these cases drive the PUBLISHED @12-apps/discounts
   routes through the harness's own app, over a real Postgres. Each case resets to
   the seeded fixture first. */
/**
 * The discounts surface as a CONSUMER gets it (FUT-244): the published routes,
 * adopted through `@12-apps/wiring/consumer`, answering over PGlite with rows
 * the package's own migration created.
 *
 * The host here is a lighthouse authority in a domain the package was NOT
 * extracted from — its catalog is two categories and three items in tables the
 * package has never heard of. That is the point after 1.0: a consumer proof
 * written against the origin host's vocabulary would be proving nothing about
 * portability at all.
 *
 * What these cases are FOR is the half a package cannot test alone. Every rule
 * (the either/or column folding, the scope narrowing, the combo validation) has
 * its own unit suite upstream, in memory. What only a host can answer is
 * whether the rules survive the round trip through a real store: whether a
 * PERCENTAGE write really lands with `amount_off_cents` NULL, whether a
 * CATEGORY-scoped write really drops the item ids it was handed, whether the
 * cross-tenant guard really consults the HOST's tables.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { DISCOUNTS_TENANT_B_ID, DISCOUNTS_TENANT_ID } from '../src/discounts-db';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

beforeEach(async () => {
  const reset = await backend.app.request('/__harness/reset', { method: 'POST' });
  expect(reset.status).toBe(204);
});

const BASE = `/api/admin/${DISCOUNTS_TENANT_ID}/discounts`;

async function post(body: unknown, tenant = DISCOUNTS_TENANT_ID): Promise<Response> {
  return backend.app.request(`/api/admin/${tenant}/discounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The minimum a valid PERCENTAGE discount needs, so a case states only its point. */
function percentage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Dez por cento',
    type: 'PERCENTAGE',
    percentOffBp: 1000,
    scope: 'ORDER',
    trigger: 'AUTOMATIC',
    stackable: true,
    active: true,
    ...overrides,
  };
}

interface CreatedBody {
  data: {
    id: string;
    name: string;
    type: string;
    percentOffBp: number | null;
    amountOffCents: number | null;
    scope: string;
    categoryIds: string[];
    menuItemIds: string[];
  };
}

describe('the write path, through a real store', () => {
  it('creates a discount and reads it back with the columns the rules folded', async () => {
    const response = await post(percentage());
    expect(response.status).toBe(200);
    const created = (await response.json()) as CreatedBody;

    // The either/or fold, asserted where it actually matters — after a round
    // trip through a NOT NULL-checked table. The package forces the unused half
    // to null so the "exactly one value column" CHECK holds; a store that
    // passed the form's leftover through would 500 here, not upstream.
    expect(created.data.percentOffBp).toBe(1000);
    expect(created.data.amountOffCents).toBeNull();

    const read = await backend.app.request(`${BASE}/${created.data.id}`);
    expect(read.status).toBe(200);
    expect(((await read.json()) as CreatedBody).data.name).toBe('Dez por cento');
  });

  it('narrows the targets to the scope, dropping what the scope cannot use', async () => {
    // ORDER scope takes NO targets. Handing it both kinds is exactly what a
    // form does when an operator picks a scope last, and `targetsForScope` is
    // what stops those ids reaching the join table.
    const response = await post(
      percentage({ categoryIds: ['cat-bebidas'], menuItemIds: ['item-cafe'] }),
    );
    expect(response.status).toBe(200);
    const created = (await response.json()) as CreatedBody;
    expect(created.data.categoryIds).toEqual([]);
    expect(created.data.menuItemIds).toEqual([]);
  });

  it('keeps the targets a CATEGORY-scoped discount is entitled to', async () => {
    const response = await post(
      percentage({ scope: 'CATEGORY', categoryIds: ['cat-bebidas'], menuItemIds: ['item-cafe'] }),
    );
    expect(response.status).toBe(200);
    const created = (await response.json()) as CreatedBody;
    expect(created.data.categoryIds).toEqual(['cat-bebidas']);
    // Still dropped: a CATEGORY-scoped rule does not carry item targets.
    expect(created.data.menuItemIds).toEqual([]);
  });

  it('refuses a target this tenant does not own', async () => {
    // The cross-tenant guard, consulted against the HOST's tables. Without it a
    // crafted write points one store's promotion at another store's catalog,
    // and the reverse menu-badge lookup then advertises it there.
    const response = await post(percentage({ scope: 'CATEGORY', categoryIds: ['cat-de-outra-loja'] }));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; issues: Record<string, string> };
    // The exact sentence, in pt-BR, because this host passed the pt-BR pack BY
    // HAND. A package that had defaulted its copy would answer English here and
    // the adoption would look identical from every other angle.
    expect(body.error).toBe('Selecione categorias e produtos desta loja.');
    // Keyed by the FIELD, so a form can put the message under the picker the
    // operator got wrong rather than at the top of the page.
    expect(body.issues.targets).toBe(body.error);
  });

  it('refuses a percentage with no rate, at the package rather than the column', async () => {
    const response = await post(percentage({ percentOffBp: undefined }));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; issues: Record<string, string> };
    // Named against `percentOff` — the FORM's field — rather than
    // `percentOffBp`, the column. The package translates one to the other so a
    // host's form binds to what it rendered, and only a round trip shows it.
    expect(body.issues.percentOff).toBe(body.error);
    expect(body.error).toContain('porcentagem');
  });
});

describe('the read path', () => {
  it('paginates and reports a total the page math can be trusted against', async () => {
    for (const index of [1, 2, 3]) await post(percentage({ name: `Promo ${index}` }));

    const response = await backend.app.request(`${BASE}?page=1&pageSize=2`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: unknown[];
      pagination: { total: number; pageCount: number; hasNextPage: boolean };
    };
    expect(body.data).toHaveLength(2);
    expect(body.pagination.total).toBe(3);
    expect(body.pagination.pageCount).toBe(2);
    expect(body.pagination.hasNextPage).toBe(true);
  });

  it('matches the search term against name and code alike', async () => {
    await post(percentage({ name: 'Combo manha' }));
    await post(percentage({ name: 'Outra coisa', trigger: 'CODE', code: 'MANHA10' }));
    await post(percentage({ name: 'Nada a ver' }));

    const response = await backend.app.request(`${BASE}?q=manha`);
    const body = (await response.json()) as { data: { name: string }[] };
    // Two hits from one lower-case term: one by name, one by code. The config
    // declares BOTH fields searchable and the match case-insensitive — which is
    // case only, not accents. A host that wants accent folding normalizes into
    // its own column, and this store deliberately does not, so that the
    // package's actual claim is what gets asserted here.
    expect(body.data.map((row) => row.name).sort()).toEqual(['Combo manha', 'Outra coisa']);
  });

  it('answers the target picker from the host catalog, labelled in the host language', async () => {
    const response = await backend.app.request(`${BASE}/targets`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { targetType: string; slug: string; label: string; targets: { id: string }[] }[];
    };
    const categories = body.data.find((group) => group.targetType === 'CATEGORY');
    expect(categories?.label).toBe('Categorias');
    expect(categories?.targets.map((target) => target.id).sort()).toEqual([
      'cat-bebidas',
      'cat-lanches',
    ]);
  });
});

describe('tenant isolation', () => {
  it('does not show one tenant a discount another tenant created', async () => {
    await post(percentage({ name: 'Só da loja A' }));

    const response = await backend.app.request(
      `/api/admin/${DISCOUNTS_TENANT_B_ID}/discounts`,
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { data: unknown[] }).data).toEqual([]);
  });

  it('will not read a foreign discount by id', async () => {
    const created = (await (await post(percentage())).json()) as CreatedBody;

    const response = await backend.app.request(
      `/api/admin/${DISCOUNTS_TENANT_B_ID}/discounts/${created.data.id}`,
    );
    // 404 rather than 403, deliberately: telling a caller a row EXISTS but is
    // not theirs is itself a leak about another store's catalog.
    expect(response.status).toBe(404);
  });
});

describe('archive', () => {
  it('takes the row out of every read without deleting it', async () => {
    const created = (await (await post(percentage())).json()) as CreatedBody;

    const archived = await backend.app.request(`${BASE}/${created.data.id}`, { method: 'DELETE' });
    expect(archived.status).toBe(200);

    expect((await backend.app.request(`${BASE}/${created.data.id}`)).status).toBe(404);
    const list = (await (await backend.app.request(BASE)).json()) as { data: unknown[] };
    expect(list.data).toEqual([]);

    // Still THERE, which is the difference between an archive and a delete:
    // order history holds frozen snapshots pointing at this row.
    const rows = await backend.pg.query<{ total: string }>(
      'SELECT COUNT(*)::text AS total FROM discounts WHERE id = $1',
      [created.data.id],
    );
    expect(rows.rows[0]?.total).toBe('1');
  });
});
