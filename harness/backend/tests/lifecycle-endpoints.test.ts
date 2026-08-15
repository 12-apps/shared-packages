/* eslint-disable test-flakiness/no-database-operations -- the database is the
   subject: these are the origin host's lifecycle route suites (versions / drafts /
   recycle-bin / change-requests), ported to run against the PUBLISHED tarball
   over a real Postgres (PGlite), driving the same app the browser drives. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { LIFECYCLE_TENANT_ID, LIFECYCLE_TENANT_OFF_ID } from '../src/lifecycle-host';

/**
 * The @12-apps/entity-lifecycle surface end-to-end (12-17): the port of
 * the origin host's colocated route tests for `[id]/versions`,
 * `[id]/versions/[version]/restore`, `[id]/draft`, `drafts/**`,
 * `recycle-bin/**` and `approvals/**` — now exercised through the published
 * package's own Hono router, generated from two registrations, over its own
 * migrations, with the host reduced to the seams ADOPTING.md names (actor
 * header, feature-layer fixture, directory, PGlite-backed db, entity ops).
 */

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

/** Drive the app as a given seeded user (the host's actor seam). */
function asUser(userId: string, tenantId: string = LIFECYCLE_TENANT_ID) {
  const base = `/api/admin/${tenantId}`;
  const headers = { 'x-lifecycle-user': userId, 'content-type': 'application/json' };
  return {
    get: (path: string) => backend.app.request(`${base}${path}`, { headers }),
    send: (method: string, path: string, body?: unknown) =>
      backend.app.request(`${base}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface Outcome {
  applied: boolean;
  entityId: string | null;
  requestId: string | null;
}

/** owner-1 saves an item edit through the host's demo CRUD (applies at once). */
async function ownerEdits(id: string, name: string, priceCents = 500): Promise<Outcome> {
  const response = await asUser('owner-1').send('PUT', `/catalog-items/${id}`, {
    name,
    priceCents,
  });
  expect(response.status).toBe(200);
  return (await json<{ data: Outcome }>(response)).data;
}

describe('versions — history and restore through the generated endpoints', () => {
  it('records versions for host writes and lists them newest first, with names', async () => {
    await ownerEdits('prod-agua', 'Água com gás 500ml');
    await ownerEdits('prod-agua', 'Água com gás 1L', 700);

    const response = await asUser('owner-1').get('/catalog-items/prod-agua/versions');
    expect(response.status).toBe(200);
    const { data } = await json<{
      data: {
        versions: { version: number; kind: string; actorName: string | null; changedFields: string[] }[];
        publishedVersion: number;
      };
    }>(response);
    // The seeded row predates the lifecycle, so the first write records v1
    // as a CREATE-shaped snapshot; the second is a delta.
    expect(data.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(data.versions[0]?.actorName).toBe('Ana Proprietária');
    expect(data.versions[0]?.changedFields).toEqual(
      expect.arrayContaining(['name', 'priceCents']),
    );
    expect(data.publishedVersion).toBe(2);
  });

  it('restores an old version, records a RESTORE row and mirrors the column', async () => {
    await ownerEdits('prod-suco', 'Suco de laranja natural');
    await ownerEdits('prod-suco', 'Suco de uva');

    const restore = await asUser('owner-1').send(
      'POST',
      '/catalog-items/prod-suco/versions/1/restore',
    );
    expect(restore.status).toBe(200);
    expect((await json<{ data: Outcome }>(restore)).data.applied).toBe(true);

    const list = await asUser('owner-1').get('/catalog-items');
    const items = (
      await json<{ data: { items: { id: string; name: string; publishedVersion: number }[] } }>(
        list,
      )
    ).data.items;
    const suco = items.find((item) => item.id === 'prod-suco');
    expect(suco?.name).toBe('Suco de laranja natural');
    expect(suco?.publishedVersion).toBe(3);

    const history = await json<{ data: { versions: { kind: string }[] } }>(
      await asUser('owner-1').get('/catalog-items/prod-suco/versions'),
    );
    expect(history.data.versions[0]?.kind).toBe('RESTORE');
  });

  it('answers publishedVersion 0 for an ARCHIVED entity, so every row can restore', async () => {
    // The host's mirror-column read filters `archived_at IS NULL` like every
    // other read it owns (ADOPTING rule 3), so a binned entity answers `null`
    // — which the surface renders as 0. That is what makes the dialog offer
    // Restaurar on the newest row too, instead of labelling it "Versão atual"
    // on a record that is no longer live.
    await ownerEdits('prod-agua', 'Água com gás 500ml');
    await ownerEdits('prod-agua', 'Água com gás 1L', 700);
    expect((await asUser('owner-1').send('DELETE', '/catalog-items/prod-agua')).status).toBe(200);

    const response = await asUser('owner-1').get('/catalog-items/prod-agua/versions');
    expect(response.status).toBe(200);
    const { data } = await json<{
      data: { versions: { version: number }[]; publishedVersion: number };
    }>(response);
    expect(data.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(data.publishedVersion).toBe(0);
  });

  it('rejects a non-integer version id rather than restoring the truncated one', async () => {
    await ownerEdits('prod-suco', 'Suco de uva');
    for (const version of ['1.5', '1abc', '0']) {
      const response = await asUser('owner-1').send(
        'POST',
        `/catalog-items/prod-suco/versions/${version}/restore`,
      );
      expect(response.status).toBe(400);
      expect((await json<{ error: string }>(response)).error).toBe('Dados inválidos.');
    }
    // Untouched: a client that formatted a float restored nothing.
    const items = await json<{ data: { items: { id: string; name: string }[] } }>(
      await asUser('owner-1').get('/catalog-items'),
    );
    expect(items.data.items.find((item) => item.id === 'prod-suco')?.name).toBe('Suco de uva');
  });

  it('is feature-gated per tenant: the un-entitled tenant gets the pt-BR 403', async () => {
    const response = await asUser('owner-1', LIFECYCLE_TENANT_OFF_ID).get(
      '/catalog-items/prod-agua/versions',
    );
    expect(response.status).toBe(403);
    expect((await json<{ error: string }>(response)).error).toBe(
      'Este recurso não está ativo para esta loja.',
    );
  });

  it('401s an unauthenticated caller before any handler runs', async () => {
    const response = await asUser('anonymous').get('/catalog-items/prod-agua/versions');
    expect(response.status).toBe(401);
  });
});

/**
 * ADOPTING rule 7, made falsifiable. The host owns an ordinary
 * `GET /catalog-items/:id` — two segments, the same shape as the package's
 * literal `GET /catalog-items/drafts` — and Hono resolves by REGISTRATION
 * order, so which of the two answers `/catalog-items/drafts` is decided by
 * `app.ts` alone. Nothing inside the package can protect it: its own
 * descriptor order only orders paths within its router.
 *
 * Move `app.route(prefix, lifecycle.router)` after the host's CRUD block and
 * the first case below fails with the host's 404 — the exact silent breakage
 * a first adoption would ship, since every other endpoint keeps working.
 */
describe('mount order — the host route that can swallow a packaged endpoint', () => {
  it('serves the packaged /drafts, not the host route of the same shape', async () => {
    const response = await asUser('owner-1').get('/catalog-items/drafts');
    expect(response.status).toBe(200);
    // The drafts LIST envelope. The host's read-one answers `{ data: { item } }`
    // (or a 404 for the id "drafts"), so this key is the discriminator.
    const body = await json<{ data: { drafts?: unknown[]; item?: unknown } }>(response);
    expect(body.data.drafts).toEqual([]);
    expect(body.data.item).toBeUndefined();
  });

  it('still routes a REAL id to the host, which is why the order is safe', async () => {
    const response = await asUser('owner-1').get('/catalog-items/prod-agua');
    expect(response.status).toBe(200);
    const body = await json<{ data: { item: { id: string; name: string } } }>(response);
    expect(body.data.item.id).toBe('prod-agua');
    expect(body.data.item.name).toBe('Água com gás');
  });

  it('leaves the host owning the 3-segment shapes it registered', async () => {
    // `PUT /catalog-items/:id` (host) and `PUT /catalog-items/:id/draft`
    // (package) differ in segment count, so both survive the same order.
    expect((await asUser('owner-1').send('PUT', '/catalog-items/prod-agua', {
      name: 'Água mineral',
      priceCents: 500,
    })).status).toBe(200);
    const draft = await asUser('owner-1').send('PUT', '/catalog-items/prod-agua/draft', {
      data: { name: 'Água mineral com gás', priceCents: 600 },
    });
    expect(draft.status).toBe(200);
  });
});

describe('drafts — the unpublished working copy', () => {
  it('saves and reads a per-item draft without touching the live record', async () => {
    const put = await asUser('owner-1').send('PUT', '/catalog-items/prod-agua/draft', {
      data: { name: 'Água tônica', priceCents: 900 },
    });
    expect(put.status).toBe(200);
    const draft = (await json<{ data: { draft: { id: string; entityId: string } } }>(put)).data
      .draft;
    expect(draft.entityId).toBe('prod-agua');

    const live = await json<{ data: { items: { id: string; name: string }[] } }>(
      await asUser('owner-1').get('/catalog-items'),
    );
    expect(live.data.items.find((item) => item.id === 'prod-agua')?.name).toBe('Água com gás');

    const get = await json<{ data: { draft: { id: string } | null } }>(
      await asUser('owner-1').get('/catalog-items/prod-agua/draft'),
    );
    expect(get.data.draft?.id).toBe(draft.id);
  });

  it('publishes a draft onto the live record and closes it', async () => {
    const put = await asUser('owner-1').send('PUT', '/catalog-items/prod-agua/draft', {
      data: { name: 'Água tônica', priceCents: 900 },
    });
    const draft = (await json<{ data: { draft: { id: string } } }>(put)).data.draft;

    const publish = await asUser('owner-1').send(
      'POST',
      `/catalog-items/drafts/${draft.id}/publish`,
    );
    expect(publish.status).toBe(200);
    expect((await json<{ data: Outcome }>(publish)).data.applied).toBe(true);

    const live = await json<{ data: { items: { id: string; name: string }[] } }>(
      await asUser('owner-1').get('/catalog-items'),
    );
    expect(live.data.items.find((item) => item.id === 'prod-agua')?.name).toBe('Água tônica');

    const open = await json<{ data: { draft: unknown | null } }>(
      await asUser('owner-1').get('/catalog-items/prod-agua/draft'),
    );
    expect(open.data.draft).toBeNull();
  });

  it('creates a brand-new item from a NEW-item draft on publish', async () => {
    const post = await asUser('owner-1').send('POST', '/catalog-items/drafts', {
      data: { name: 'Chá gelado', priceCents: 800 },
    });
    expect(post.status).toBe(200);
    const draft = (await json<{ data: { draft: { id: string; entityId: null } } }>(post)).data
      .draft;
    expect(draft.entityId).toBeNull();

    const listed = await json<{ data: { drafts: { id: string }[] } }>(
      await asUser('owner-1').get('/catalog-items/drafts'),
    );
    expect(listed.data.drafts.map((row) => row.id)).toContain(draft.id);

    const publish = await asUser('owner-1').send(
      'POST',
      `/catalog-items/drafts/${draft.id}/publish`,
    );
    expect(publish.status).toBe(200);

    const live = await json<{ data: { items: { name: string }[] } }>(
      await asUser('owner-1').get('/catalog-items'),
    );
    expect(live.data.items.map((item) => item.name)).toContain('Chá gelado');
  });

  it('discards a draft as the bodyless 204 and keeps the live record', async () => {
    const put = await asUser('owner-1').send('PUT', '/catalog-items/prod-suco/draft', {
      data: { name: 'Suco descartado', priceCents: 1 },
    });
    const draft = (await json<{ data: { draft: { id: string } } }>(put)).data.draft;

    const discard = await asUser('owner-1').send('DELETE', `/catalog-items/drafts/${draft.id}`);
    expect(discard.status).toBe(204);
    expect(await discard.text()).toBe('');

    const live = await json<{ data: { items: { id: string; name: string }[] } }>(
      await asUser('owner-1').get('/catalog-items'),
    );
    expect(live.data.items.find((item) => item.id === 'prod-suco')?.name).toBe('Suco de laranja');
  });

  it('404s the pt-BR copy for a foreign draft id', async () => {
    const response = await asUser('owner-1').send('DELETE', '/catalog-items/drafts/nope');
    expect(response.status).toBe(404);
    expect((await json<{ error: string }>(response)).error).toBe('Este rascunho não existe mais.');
  });
});

describe('recycle bin — the cross-collection surface', () => {
  it('a deleted item lands in the bin and restores back to the list', async () => {
    const removed = await asUser('owner-1').send('DELETE', '/catalog-items/prod-agua');
    expect(removed.status).toBe(200);

    const bin = await json<{
      data: { entries: { id: string; entityType: string; label: string }[] };
    }>(await asUser('owner-1').get('/recycle-bin'));
    expect(bin.data.entries).toHaveLength(1);
    expect(bin.data.entries[0]?.entityType).toBe('product');
    expect(bin.data.entries[0]?.label).toBe('Água com gás');

    const restore = await asUser('owner-1').send(
      'POST',
      `/recycle-bin/${bin.data.entries[0]?.id}/restore`,
    );
    expect(restore.status).toBe(204);

    const live = await json<{ data: { items: { id: string }[] } }>(
      await asUser('owner-1').get('/catalog-items'),
    );
    expect(live.data.items.map((item) => item.id)).toContain('prod-agua');

    const emptied = await json<{ data: { entries: unknown[] } }>(
      await asUser('owner-1').get('/recycle-bin'),
    );
    expect(emptied.data.entries).toHaveLength(0);
  });

  it('dispatches across collections: a supplier entry restores as a supplier', async () => {
    await asUser('owner-1').send('DELETE', '/catalog-items/prod-agua');
    await asUser('owner-1').send('DELETE', '/demo-suppliers/sup-distribuidora');

    const bin = await json<{ data: { entries: { entityType: string; label: string }[] } }>(
      await asUser('owner-1').get('/recycle-bin'),
    );
    expect(bin.data.entries.map((entry) => entry.entityType).sort()).toEqual([
      'product',
      'supplier',
    ]);

    const narrowed = await json<{ data: { entries: { entityType: string }[] } }>(
      await asUser('owner-1').get('/recycle-bin?entityType=supplier'),
    );
    expect(narrowed.data.entries).toHaveLength(1);
    expect(narrowed.data.entries[0]?.entityType).toBe('supplier');
  });

  it('purges permanently: 204, hard-gone, and the entry leaves the bin', async () => {
    await asUser('owner-1').send('DELETE', '/catalog-items/prod-agua');
    const bin = await json<{ data: { entries: { id: string }[] } }>(
      await asUser('owner-1').get('/recycle-bin'),
    );
    const entryId = bin.data.entries[0]?.id as string;

    const purge = await asUser('owner-1').send('DELETE', `/recycle-bin/${entryId}`);
    expect(purge.status).toBe(204);

    // Gone from the bin, and a repeat purge is the pt-BR 404.
    const emptied = await json<{ data: { entries: unknown[] } }>(
      await asUser('owner-1').get('/recycle-bin'),
    );
    expect(emptied.data.entries).toHaveLength(0);
    const repeat = await asUser('owner-1').send('DELETE', `/recycle-bin/${entryId}`);
    expect(repeat.status).toBe(422);
  });

  it('is tenant-isolated: the neighbour tenant sees an empty bin', async () => {
    await asUser('owner-1').send('DELETE', '/catalog-items/prod-agua');
    const foreign = await json<{ data: { entries: unknown[] } }>(
      await asUser('owner-1', LIFECYCLE_TENANT_OFF_ID).get('/recycle-bin'),
    );
    expect(foreign.data.entries).toHaveLength(0);
  });
});

describe('approvals — writes by non-approvers park as change requests', () => {
  it("an editor's edit answers 202 and leaves the live record untouched", async () => {
    const response = await asUser('editor-1').send('PUT', '/catalog-items/prod-agua', {
      name: 'Água adulterada',
      priceCents: 1,
    });
    expect(response.status).toBe(202);
    const outcome = (await json<{ data: Outcome }>(response)).data;
    expect(outcome.applied).toBe(false);
    expect(outcome.requestId).toBeTruthy();

    const live = await json<{ data: { items: { id: string; name: string }[] } }>(
      await asUser('owner-1').get('/catalog-items'),
    );
    expect(live.data.items.find((item) => item.id === 'prod-agua')?.name).toBe('Água com gás');
  });

  it('the inbox lists the parked request with label and requester name', async () => {
    await asUser('editor-1').send('PUT', '/catalog-items/prod-agua', {
      name: 'Água nova',
      priceCents: 500,
    });
    const inbox = await json<{
      data: { requests: { label: string; requestedByName: string | null; action: string }[] };
    }>(await asUser('owner-1').get('/approvals'));
    expect(inbox.data.requests).toHaveLength(1);
    expect(inbox.data.requests[0]?.label).toBe('Água nova');
    expect(inbox.data.requests[0]?.action).toBe('UPDATE');
    expect(inbox.data.requests[0]?.requestedByName).toBe('Eduardo Editor');
  });

  it('approve applies the parked write; the double decide is the 409', async () => {
    const parked = await json<{ data: Outcome }>(
      await asUser('editor-1').send('PUT', '/catalog-items/prod-agua', {
        name: 'Água aprovada',
        priceCents: 600,
      }),
    );
    const requestId = parked.data.requestId as string;

    const denied = await asUser('editor-1').send('POST', `/approvals/${requestId}/approve`);
    expect(denied.status).toBe(403);
    expect((await json<{ error: string }>(denied)).error).toBe(
      'Você não tem permissão para aprovar alterações.',
    );

    const approved = await asUser('owner-1').send('POST', `/approvals/${requestId}/approve`);
    expect(approved.status).toBe(200);
    expect((await json<{ data: Outcome }>(approved)).data.applied).toBe(true);

    const live = await json<{ data: { items: { id: string; name: string }[] } }>(
      await asUser('owner-1').get('/catalog-items'),
    );
    expect(live.data.items.find((item) => item.id === 'prod-agua')?.name).toBe('Água aprovada');

    const again = await asUser('owner-1').send('POST', `/approvals/${requestId}/approve`);
    expect(again.status).toBe(409);
    expect((await json<{ error: string }>(again)).error).toBe('Esta solicitação já foi decidida.');
  });

  it('reject keeps the record, stores the note and moves the request to REJECTED', async () => {
    const parked = await json<{ data: Outcome }>(
      await asUser('editor-1').send('PUT', '/catalog-items/prod-agua', {
        name: 'Água rejeitada',
        priceCents: 1,
      }),
    );
    const requestId = parked.data.requestId as string;

    const rejected = await asUser('owner-1').send('POST', `/approvals/${requestId}/reject`, {
      note: 'preço errado',
    });
    expect(rejected.status).toBe(204);

    const live = await json<{ data: { items: { id: string; name: string }[] } }>(
      await asUser('owner-1').get('/catalog-items'),
    );
    expect(live.data.items.find((item) => item.id === 'prod-agua')?.name).toBe('Água com gás');

    const decided = await json<{
      data: { requests: { status: string; decisionNote: string | null }[] };
    }>(await asUser('owner-1').get('/approvals?status=REJECTED'));
    expect(decided.data.requests[0]?.status).toBe('REJECTED');
    expect(decided.data.requests[0]?.decisionNote).toBe('preço errado');
  });

  it("a parked DELETE keeps the row out of the bin until it is approved", async () => {
    const parked = await asUser('editor-1').send('DELETE', '/catalog-items/prod-suco');
    expect(parked.status).toBe(202);
    const requestId = (await json<{ data: Outcome }>(parked)).data.requestId as string;

    const bin = await json<{ data: { entries: unknown[] } }>(
      await asUser('owner-1').get('/recycle-bin'),
    );
    expect(bin.data.entries).toHaveLength(0);

    const approved = await asUser('owner-1').send('POST', `/approvals/${requestId}/approve`);
    expect(approved.status).toBe(200);

    const after = await json<{ data: { entries: { label: string }[] } }>(
      await asUser('owner-1').get('/recycle-bin'),
    );
    expect(after.data.entries.map((entry) => entry.label)).toContain('Suco de laranja');
  });
});
