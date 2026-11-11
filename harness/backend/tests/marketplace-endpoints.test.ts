/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   the database IS the subject: these cases drive the PUBLISHED @12-apps/marketplace
   routes and jobs through the harness's own app, over the generated Prisma client
   and the package's own migration. Each case uses its own marketplace order ids. */
/**
 * `@12-apps/marketplace` as a consumer installs it: the tarball's engine, its
 * iFood adapter, its webhook and bulk routes mounted under `/api`, and its
 * jobs bound through the wiring consumer. Nothing reaches the network: the
 * engine's HTTP port is the host's in-memory fake (`marketplace-host.ts`).
 */
import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderWiringReport, unclaimedRoutes } from '@12-apps/wiring/consumer';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { MARKETPLACE_TENANT, MARKETPLACE_USER_HEADER, SHORT_SKU } from '../src/marketplace-host';

let backend: HarnessBackend;
const SECRET = 'harness-webhook-secret';
const BASE = `/api/admin/${MARKETPLACE_TENANT}/marketplace`;

beforeAll(async () => {
  backend = await createHarnessBackend();
  const connected = await json('PUT', BASE, {
    integrations: [
      {
        provider: 'IFOOD',
        enabled: true,
        externalMerchantId: 'merchant-harness',
        credentials: { clientId: 'app-id', clientSecret: 'app-secret', webhookSecret: SECRET },
      },
    ],
  });
  expect(connected.status).toBe(200);
}, 120_000);

afterAll(async () => {
  await backend.close();
});

async function json(method: string, path: string, body?: unknown) {
  const response = await backend.app.request(path, {
    method,
    headers: { 'content-type': 'application/json', [MARKETPLACE_USER_HEADER]: 'user-1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** One signed iFood delivery, through the mounted webhook. */
async function deliver(payload: unknown, secret = SECRET) {
  const raw = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  const response = await backend.app.request(`/api/webhooks/marketplace/${MARKETPLACE_TENANT}/IFOOD`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ifood-signature': signature },
    body: raw,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function placed(orderId: string, sku = 'SKU-1') {
  return {
    id: `evt-${orderId}`,
    code: 'PLC',
    merchantId: 'merchant-harness',
    orderId,
    order: {
      displayId: '4821',
      customer: { name: 'Ana' },
      items: [{ externalCode: sku, name: 'Item', quantity: 1, unitPrice: 25 }],
      total: { orderAmount: 25 },
    },
  };
}

async function hostOrder(id: string) {
  const { rows } = await backend.pg.query<{ status: string; total_cents: number }>(
    'SELECT status, total_cents FROM harness_marketplace_orders WHERE id = $1',
    [id],
  );
  return rows[0];
}

describe('the adoption', () => {
  it('assembles a clean report with every route claimed and the four jobs bound', () => {
    const marketplace = backend.hosts.marketplace;
    const [entry] = marketplace.report.packages;
    expect(entry?.packageName).toBe('@12-apps/marketplace');
    expect(entry?.capabilities.map((capability) => capability.status)).not.toContain('unbound');
    // Every descriptor is claimed by the mount, the webhook included.
    const claimed = marketplace.routes.map((r) => `${r.route.method} ${r.mountPath}${r.route.path}`);
    expect(unclaimedRoutes(marketplace.routes, claimed), renderWiringReport(marketplace.report)).toEqual([]);
    expect(marketplace.routes).toHaveLength(7);
    expect(marketplace.jobs.map((job) => job.name).sort()).toEqual([
      'marketplace.expire-acceptances',
      'marketplace.outbound',
      'marketplace.outbound-sweep',
      'marketplace.reconcile-inbox',
    ]);
  });
});

describe('a signed iFood delivery', () => {
  it('is ingested through the mounted webhook into the host order and the acceptance queue', async () => {
    const answer = await deliver(placed('h-1'));

    expect(answer).toEqual({ status: 200, body: { received: true, outcome: 'ingested' } });
    expect(await hostOrder('mp-h-1')).toEqual({ status: 'PENDING', total_cents: 2500 });
    const queue = await json('GET', `${BASE}/acceptances?ids=mp-h-1`);
    expect((queue.body.data as { orderId: string; buyerName: string }[])[0]).toMatchObject({
      orderId: 'mp-h-1',
      buyerName: 'Ana',
    });
  });

  it('is refused with a 401 under the wrong secret, and nothing is created', async () => {
    const answer = await deliver(placed('h-bad'), 'not-the-secret');
    expect(answer.status).toBe(401);
    expect(await hostOrder('mp-h-bad')).toBeUndefined();
  });
});

describe('deciding in bulk', () => {
  it('accepts and refuses in one call, then the bound outbound job confirms and requests on the fake marketplace', async () => {
    await deliver(placed('h-2'));
    await deliver(placed('h-3'));
    const marketplace = backend.hosts.marketplace;
    marketplace.queued.length = 0;
    marketplace.requests.length = 0;

    const decided = await json('POST', `${BASE}/acceptances`, {
      decisions: [
        { orderId: 'mp-h-2', decision: 'ACCEPT' },
        { orderId: 'mp-h-3', decision: 'REJECT', reasonCode: '503' },
      ],
    });

    expect(decided.status).toBe(200);
    expect(await hostOrder('mp-h-2')).toMatchObject({ status: 'ACCEPTED' });
    expect(await hostOrder('mp-h-3')).toMatchObject({ status: 'REJECTED' });
    expect(marketplace.queued.map((job) => `${job.action}:${job.orderId}`)).toEqual([
      'confirm:mp-h-2',
      'requestCancellation:mp-h-3',
    ]);
    expect(marketplace.requests).toEqual([]);

    const job = marketplace.jobs.find((candidate) => candidate.name === 'marketplace.outbound');
    const context = { runId: 'r', attempt: 1, maxAttempts: 3, logger: console };
    for (const payload of marketplace.queued) await job?.handle(payload as never, context);

    expect(marketplace.requests.map((request) => request.url)).toEqual([
      'https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token',
      'https://merchant-api.ifood.com.br/order/v1.0/orders/h-2/confirm',
      'https://merchant-api.ifood.com.br/order/v1.0/orders/h-3/requestCancellation',
    ]);
    const { rows } = await backend.pg.query<{ order_id: string; confirmed_at: Date | null; cancellation_status: string | null }>(
      "SELECT order_id, confirmed_at, cancellation_status FROM marketplace_acceptances WHERE order_id IN ('mp-h-2', 'mp-h-3') ORDER BY order_id",
    );
    expect(rows[0]?.confirmed_at).toBeInstanceOf(Date);
    expect(rows[1]?.cancellation_status).toBe('REQUESTED');
  });

  it("answers the host's stock ask as a 409 that writes nothing, then accepts once admitted", async () => {
    await deliver(placed('h-4', SHORT_SKU));

    const asked = await json('POST', `${BASE}/acceptances`, { decisions: [{ orderId: 'mp-h-4', decision: 'ACCEPT' }] });
    expect(asked).toMatchObject({ status: 409, body: { code: 'MARKETPLACE_STOCK_ASK', details: { short: [SHORT_SKU] } } });
    expect(await hostOrder('mp-h-4')).toMatchObject({ status: 'PENDING' });

    const admitted = await json('POST', `${BASE}/acceptances`, {
      decisions: [{ orderId: 'mp-h-4', decision: 'ACCEPT', admission: { admitStockPastZero: true } }],
    });
    expect(admitted.status).toBe(200);
    expect(await hostOrder('mp-h-4')).toMatchObject({ status: 'ACCEPTED' });
  });
});

describe('connections', () => {
  it('archives through the bulk tool, with the audit line written in the same transaction, and unarchives', async () => {
    const archived = await json('PUT', BASE, { integrations: [{ operation: 'archive', provider: 'IFOOD', reason: 'paused' }] });
    expect(archived.status).toBe(200);
    expect((await json('GET', BASE)).body.data).toEqual([]);
    expect((await deliver(placed('h-archived'))).status).toBe(401);

    await json('PUT', BASE, { integrations: [{ operation: 'unarchive', provider: 'IFOOD' }] });
    const { rows } = await backend.pg.query<{ action: string; actor_id: string; reason: string | null }>(
      'SELECT action, actor_id, reason FROM harness_marketplace_audit ORDER BY id',
    );
    expect(rows).toEqual([
      { action: 'marketplace.integration.archive', actor_id: 'user-1', reason: 'paused' },
      { action: 'marketplace.integration.unarchive', actor_id: 'user-1', reason: null },
    ]);
    expect((await deliver(placed('h-back'))).status).toBe(200);
  });
});
