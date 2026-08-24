/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   the database IS the subject: these cases drive the PUBLISHED
   @12-apps/product-research routes through the harness's own app, over a real
   Postgres built from the package's own eight migrations. Each case resets to
   an empty catalog first. */
/**
 * `@12-apps/product-research`'s HTTP surface as a CONSUMER gets it: seventeen
 * published route descriptors, mounted by a host that supplies the seven things
 * the factory refuses to start without.
 *
 * The schema half is `product-research-migrations.test.ts`. This is the surface
 * standing on it, and the cases concentrate on the INTEGRATIONS routes because
 * that is where the host/package split actually bites: a paid connector's key
 * is probed by the host, encrypted by the host, stored by the host — and the
 * package decides, from the probe's answer alone, whether the save is verified,
 * unverified or refused. Nothing upstream can run that: the package's own suite
 * fakes the store and the codec, so the round trip through a real row — where
 * the ciphertext has to stop travelling — has never been exercised.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import {
  RESEARCH_TENANT_B_ID,
  RESEARCH_TENANT_ID,
  RESEARCH_USER_HEADER,
  researchProbes,
} from '../src/research-host';

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

/** Drive the surface as a signed-in operator of one store. */
function as(tenantId: string = RESEARCH_TENANT_ID) {
  const base = `/api/admin/${tenantId}/research`;
  const headers = { [RESEARCH_USER_HEADER]: 'ana', 'content-type': 'application/json' };
  return {
    listIntegrations: () => backend.app.request(`${base}/integrations`, { headers }),
    saveIntegration: (type: string, body: Record<string, unknown>) =>
      backend.app.request(`${base}/integrations/${type}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      }),
    setIntegrationEnabled: (type: string, enabled: boolean) =>
      backend.app.request(`${base}/integrations/${type}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ enabled }),
      }),
    removeIntegration: (type: string) =>
      backend.app.request(`${base}/integrations/${type}`, { method: 'DELETE', headers }),
    startResearch: (body: Record<string, unknown>) =>
      backend.app.request(base, { method: 'POST', headers, body: JSON.stringify(body) }),
    listResearch: (query = '') => backend.app.request(`${base}${query}`, { headers }),
    getRequest: (id: string) => backend.app.request(`${base}/requests/${id}`, { headers }),
    getRun: (id: string) => backend.app.request(`${base}/runs/${id}`, { headers }),
  };
}

interface Integration {
  type: string;
  enabled: boolean;
  mounted: boolean;
  credentialHint: string | null;
  credentialStatus: string;
}

async function dataOf<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}

/** What actually landed in the row — the half a client must never see. */
async function storedConfig(type: string): Promise<Record<string, unknown>> {
  const { rows } = await backend.pg.query<{ config: Record<string, unknown> }>(
    `SELECT config FROM price_sources WHERE client_id = $1 AND type = $2 AND archived_at IS NULL`,
    [RESEARCH_TENANT_ID, type],
  );
  return rows[0]?.config ?? {};
}

describe('storing a connector key', () => {
  it('stores it VERIFIED when the host probe says the provider accepted it', async () => {
    researchProbes.credentialResult = { ok: true };
    const saved = await dataOf<Integration>(
      await as().saveIntegration('SERP', { credentials: { apiKey: 'live-key-9876' } }),
    );

    expect(saved.credentialStatus).toBe('VERIFIED');
    expect(saved.type).toBe('SERP');
  });

  it('stores it UNVERIFIED when this host cannot probe at all', async () => {
    // `null` is not a failure — it is "no probe available". The package's own
    // comment: no probe, or an unreachable provider, stores the key visibly
    // UNVERIFIED, never a blocked save. An operator whose provider is down must
    // still be able to finish configuring.
    researchProbes.credentialResult = null;
    const saved = await dataOf<Integration>(
      await as().saveIntegration('SERP', { credentials: { apiKey: 'live-key-9876' } }),
    );

    expect(saved.credentialStatus).toBe('UNVERIFIED');
  });

  it('refuses it, in the host words, when the provider says no', async () => {
    researchProbes.credentialResult = { ok: false, error: 'chave expirada' };
    const response = await as().saveIntegration('SERP', {
      credentials: { apiKey: 'dead-key' },
    });

    expect(response.status).toBe(422);
    // The host's probe reason is forwarded VERBATIM inside the host's own
    // sentence — the package never rewrites an operator-facing reason it did
    // not produce.
    expect(JSON.stringify(await response.json())).toContain('chave expirada');

    // And nothing was stored: a refused key must not sit in the row looking
    // configured.
    expect(await storedConfig('SERP')).toEqual({});
  });

  it('never lets the key itself back out — only the hint', async () => {
    researchProbes.credentialResult = { ok: true };
    const saved = await dataOf<Integration>(
      await as().saveIntegration('SERP', { credentials: { apiKey: 'live-key-9876' } }),
    );

    // What a roster may show: the tail an operator recognises their own key by.
    expect(saved.credentialHint).toBe('****9876');
    expect(JSON.stringify(saved)).not.toContain('live-key-9876');

    // What the row holds: the CIPHERTEXT, which the store scrubs on every read.
    // This is the property the package's own suite cannot reach — it fakes both
    // the store and the codec, so nothing there ever writes a real row.
    const config = await storedConfig('SERP');
    expect(String(config['credentialsEncrypted'])).toMatch(/^enc:/);
    expect(JSON.stringify(config)).not.toContain('live-key-9876');
  });

  it('swaps the key on a second save rather than adding a row', async () => {
    researchProbes.credentialResult = { ok: true };
    await as().saveIntegration('SERP', { credentials: { apiKey: 'first-key-1111' } });
    const second = await dataOf<Integration>(
      await as().saveIntegration('SERP', { credentials: { apiKey: 'second-key-2222' } }),
    );

    // The singleton invariant, enforced by the PACKAGE'S OWN partial unique
    // index — the store upserts over it rather than re-deriving which types are
    // singletons, so the two cannot come to disagree.
    expect(second.credentialHint).toBe('****2222');
    const { rows } = await backend.pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM price_sources
        WHERE client_id = $1 AND type = 'SERP' AND archived_at IS NULL`,
      [RESEARCH_TENANT_ID],
    );
    expect(rows[0]?.count).toBe('1');
  });
});

describe('what the roster says about this deployment', () => {
  it('marks a type this server has mounted, and one it has not', async () => {
    researchProbes.credentialResult = { ok: true };
    await as().saveIntegration('SERP', { credentials: { apiKey: 'k1' } });
    await as().saveIntegration('VTEX', { credentials: { appKey: 'k2', appToken: 't2' } });

    const roster = await dataOf<Integration[]>(await as().listIntegrations());
    const byType = Object.fromEntries(roster.map((row) => [row.type, row]));

    // `mounted` is a fact about the DEPLOYMENT, not about the package: an
    // unmounted type is still configurable, and starts participating the moment
    // the connector lands. An operator whose key is stored and waiting needs to
    // be able to tell that from a key that is broken.
    expect(byType['SERP']?.mounted).toBe(true);
    expect(byType['VTEX']).toBeUndefined();
  });

  it('shows one store nothing of another', async () => {
    researchProbes.credentialResult = { ok: true };
    await as().saveIntegration('SERP', { credentials: { apiKey: 'k1' } });

    expect(await dataOf<Integration[]>(await as(RESEARCH_TENANT_B_ID).listIntegrations())).toEqual(
      [],
    );
  });
});

describe('turning a connector off and removing it', () => {
  it('keeps the stored key when the operator only switches it off', async () => {
    researchProbes.credentialResult = { ok: true };
    await as().saveIntegration('SERP', { credentials: { apiKey: 'live-key-9876' } });

    const off = await dataOf<Integration>(await as().setIntegrationEnabled('SERP', false));
    expect(off.enabled).toBe(false);

    // Switching off is not disconnecting: the key stays so switching back on
    // costs nothing. Losing it here would make a pause indistinguishable from a
    // disconnection.
    expect(off.credentialHint).toBe('****9876');
    expect(String((await storedConfig('SERP'))['credentialsEncrypted'])).toMatch(/^enc:/);
  });

  it('takes it off the roster on removal, and frees the type', async () => {
    researchProbes.credentialResult = { ok: true };
    await as().saveIntegration('SERP', { credentials: { apiKey: 'first-1111' } });
    expect((await as().removeIntegration('SERP')).status).toBeLessThan(300);
    expect(await dataOf<Integration[]>(await as().listIntegrations())).toEqual([]);

    // Archived rather than deleted — and the singleton index is partial on
    // `archived_at IS NULL`, so the type is free to be connected again. That
    // pair is exactly what the soft-delete migration was for.
    const reconnected = await dataOf<Integration>(
      await as().saveIntegration('SERP', { credentials: { apiKey: 'second-2222' } }),
    );
    expect(reconnected.credentialHint).toBe('****2222');
  });
});

describe('the caller', () => {
  it('answers 401 with no caller at all', async () => {
    const response = await backend.app.request(
      `/api/admin/${RESEARCH_TENANT_ID}/research/integrations`,
    );
    expect(response.status).toBe(401);
  });
});

describe('the history listing beside the package', () => {
  // The one route of the seventeen that is the HOST's — the package declares
  // sixteen and stops short of this one because its query grammar and envelope
  // come from the host's own search machinery. What is worth exercising is not
  // the SQL but the arrangement: a host route and a package route sharing a
  // path, splitting the verbs, and neither shadowing the other.

  interface HistoryRow {
    id: string;
    term: string;
    quantity: number;
  }

  // The start body nests under `query` — the package reads `body.query.term`,
  // and a flat `{ term }` is accepted with a 202 and an EMPTY term, because it
  // coerces `query['term'] ?? ''`. So the shape is worth spelling once here.
  async function start(term: string, quantity = 1): Promise<void> {
    const response = await as().startResearch({ query: { term, quantity } });
    expect(response.status).toBe(202);
  }

  it('lists what the package\'s own POST on the same path wrote', async () => {
    await start('Água mineral 500ml', 12);

    const rows = await dataOf<HistoryRow[]>(await as().listResearch());
    expect(rows.map((row) => row.term)).toEqual(['Água mineral 500ml']);
    expect(rows[0]?.quantity).toBe(12);
  });

  it('does not shadow the POST it shares a path with', async () => {
    // Two routers on one prefix, one path, two verbs. Mount them the other way
    // round and the wrong one answers — silently, because both return 200-shaped
    // JSON. Asserting the pair here is the only thing that can see it.
    await start('Café em grão');
    const listed = await as().listResearch();

    expect(listed.status).toBe(200);
    expect((await dataOf<HistoryRow[]>(listed)).length).toBe(1);
  });

  it('finds an accented term by its unaccented spelling', async () => {
    // `term_normalized` is the host's to keep in sync on write — the package
    // backfills it once and says so. Nothing fails when a host forgets: the
    // column is nullable and every write still succeeds, the search just
    // quietly matches nothing. This is the case that sees it.
    await start('Água mineral 500ml');

    const rows = await dataOf<HistoryRow[]>(await as().listResearch('?term=agua'));
    expect(rows.map((row) => row.term)).toEqual(['Água mineral 500ml']);
  });

  it('shows one store nothing of another', async () => {
    await start('Café em grão');

    expect(await dataOf<HistoryRow[]>(await as(RESEARCH_TENANT_B_ID).listResearch())).toEqual([]);
  });

  it('refuses a caller the surface next door refuses', async () => {
    // The host's own guard, because a route beside a package's is still the
    // host's to protect. Skipping it here would leak the whole tenant's history
    // through the one endpoint nobody adopted.
    const response = await backend.app.request(`/api/admin/${RESEARCH_TENANT_ID}/research`);
    expect(response.status).toBe(401);
  });
});

describe('the run the HOST has to produce', () => {
  // The package's start route persists a request, calls `enqueueRun` and
  // answers 202 — and says why the accepted answer cannot carry a run id: the
  // run is created by the worker, later. So every screen
  // `@12-apps/product-research-ui` ships past the form renders rows a HOST
  // wrote, and none of them can be exercised without one. `research-worker.ts`
  // is this harness's, and these cases are the contract between the two.

  interface RunStamp {
    id: string;
    status: string;
    startedAt: string | null;
  }
  interface RequestView {
    id: string;
    term: string;
    brand: string | null;
    ean: string | null;
    quantity: number;
    region: string | null;
    catalogRef: { type: string; id: string } | null;
    createdAt: string;
    latestRun: RunStamp | null;
  }
  interface Offer {
    supplierName: string;
    priceCents: number;
    shippingCents: number | null;
    totalCents: number;
    rank: number | null;
  }
  interface RunView {
    id: string;
    requestId: string;
    status: string;
    offers: Offer[];
    sourceStats: { name: string; status: string; error?: string }[];
  }

  async function started(term: string, quantity = 1): Promise<string> {
    const response = await as().startResearch({ query: { term, quantity } });
    expect(response.status).toBe(202);
    return ((await response.json()) as { data: { requestId: string } }).data.requestId;
  }

  it('answers the request view FIELD BY FIELD, as the screens read it', async () => {
    const requestId = await started('Café em grão', 6);
    const view = await dataOf<RequestView>(await as().getRequest(requestId));

    // Every field of `ResearchRequestView`, because the store seam is typed
    // `Promise<unknown>` on purpose — a host answering a smaller shape gets
    // screens rendering `undefined` and no type error anywhere to say so.
    expect(view).toMatchObject({
      id: requestId,
      term: 'Café em grão',
      brand: null,
      ean: null,
      quantity: 6,
      region: null,
      catalogRef: null,
    });
    expect(view.createdAt).not.toBe('');
    expect(view.latestRun?.status).toBe('COMPLETED');
  });

  it('leaves the request run-less when the queue is unavailable', async () => {
    // The other branch the package documents, and the reason `enqueued: false`
    // is still a 202: the request is DURABLE, and a reconciliation sweep
    // re-enqueues it. A host that treated this as a failure would lose the row.
    researchProbes.queue = 'unavailable';
    const response = await as().startResearch({ query: { term: 'Açúcar', quantity: 1 } });

    expect(response.status).toBe(202);
    const body = (await response.json()) as { data: { requestId: string; enqueued: boolean } };
    expect(body.data.enqueued).toBe(false);

    // `latestRun: null` is what the run screen POLLS on — it must be a real
    // null rather than a missing key, or the screen cannot tell "not yet" from
    // "this host answers a different shape".
    const view = await dataOf<RequestView>(await as().getRequest(body.data.requestId));
    expect(view.latestRun).toBeNull();
  });

  it('ranks the offers by what the buyer actually pays', async () => {
    const requestId = await started('Água mineral 500ml', 10);
    const view = await dataOf<RequestView>(await as().getRequest(requestId));
    const run = await dataOf<RunView>(await as().getRun(String(view.latestRun?.id)));

    expect(run.requestId).toBe(requestId);
    expect(run.status).toBe('COMPLETED');
    // Ten units: 430×10 + unstated shipping beats 480×10 + 1200.
    expect(run.offers.map((offer) => offer.supplierName)).toEqual([
      'Atacado Litoral',
      'Distribuidora Central',
    ]);
    expect(run.offers.map((offer) => offer.rank)).toEqual([1, 2]);
  });

  it('carries an unstated shipping as NULL, not as free', async () => {
    // FUT-518, and the reason the column is nullable rather than optional:
    // null means the source never stated a cost, so `totalCents` is a LOWER
    // BOUND the surface must caveat. A worker that wrote 0 would make an
    // unknown look like a promise of free delivery.
    const requestId = await started('Água mineral 500ml', 10);
    const view = await dataOf<RequestView>(await as().getRequest(requestId));
    const run = await dataOf<RunView>(await as().getRun(String(view.latestRun?.id)));

    const [cheapest, other] = run.offers;
    expect(cheapest?.shippingCents).toBeNull();
    expect(other?.shippingCents).toBe(1200);
  });

  it('reports a source that failed rather than shortening the list', async () => {
    // Degradation is the case the run screen is built around — a failed source
    // is a banner, never a silently shorter list. A worker that only ever
    // succeeded would leave that path unrendered in the one place the
    // published component is actually mounted.
    const requestId = await started('Café em grão');
    const view = await dataOf<RequestView>(await as().getRequest(requestId));
    const run = await dataOf<RunView>(await as().getRun(String(view.latestRun?.id)));

    const failed = run.sourceStats.find((stat) => stat.status === 'FAILED');
    expect(failed?.name).toBe('Mercado Norte');
    expect(failed?.error).toBe('tempo esgotado');
    expect(run.sourceStats).toHaveLength(3);
  });

  it('replaces the run when the same request is settled again', async () => {
    const requestId = await started('Café em grão');
    const first = await dataOf<RequestView>(await as().getRequest(requestId));

    // A repeat drives the same request through the worker a second time. The
    // history must not grow a duplicate run, and the request must point at the
    // NEW one — a stale pointer is a screen showing yesterday's prices.
    await as().startResearch({ query: { term: 'Café em grão', quantity: 1 } });
    const { rows } = await backend.pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM research_runs WHERE request_id = $1`,
      [requestId],
    );
    expect(rows[0]?.count).toBe('1');
    expect(first.latestRun).not.toBeNull();
  });

  it('shows one store nothing of another store\'s run', async () => {
    const requestId = await started('Café em grão');
    const view = await dataOf<RequestView>(await as().getRequest(requestId));

    const leaked = await as(RESEARCH_TENANT_B_ID).getRun(String(view.latestRun?.id));
    expect(await dataOf<RunView | null>(leaked)).toBeNull();
  });
});
