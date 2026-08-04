import { describe, expect, it } from 'vitest';

import type { ConnectorContext, FetchOutcome } from '../connectors/types';
import { deliverableSkus } from '../connectors/vtex-delivery';
import { silentLogger } from '../memory';

/**
 * The delivery verdict (FUT-514). Every case here is anchored to live traffic
 * measured against Apoio Entrega for the reported SKU: two SLAs for the CEP the
 * store serves, zero and a "não pode ser entregue" message for every CEP it
 * does not — the discrimination the regions probe could not make.
 */

const BASE = 'https://www.apoioentrega.com';
const SKUS = [
  { skuId: '21492', sellerId: '1' },
  { skuId: '11080', sellerId: '1' },
];

interface Captured {
  url?: string;
  body?: unknown;
}

const ctxWithPost = (
  outcome: FetchOutcome,
  captured: Captured = {},
): ConnectorContext => ({
  logger: silentLogger,
  fetchJson: () => Promise.resolve(null),
  postJsonResult: (url, body) => {
    captured.url = url;
    captured.body = body;
    return Promise.resolve(outcome);
  },
});

const answer = (items: { id: string }[], slas: number[]): FetchOutcome => ({
  ok: true,
  payload: {
    items,
    logisticsInfo: slas.map((count) => ({
      slas: Array.from({ length: count }, () => ({})),
    })),
  },
});

describe('deliverableSkus', () => {
  it('reports exactly the SKUs the store has an SLA for', async () => {
    const captured: Captured = {};
    const deliverable = await deliverableSkus(
      ctxWithPost(answer([{ id: '21492' }, { id: '11080' }], [2, 0]), captured),
      BASE,
      '2',
      '31610-000',
      SKUS,
    );

    expect(deliverable).toEqual(new Set(['21492']));
    expect(captured.url).toBe(
      'https://www.apoioentrega.com/api/checkout/pub/orderForms/simulation?sc=2',
    );
    // One request for the whole search, not one per offer.
    expect(captured.body).toEqual({
      items: [
        { id: '21492', quantity: 1, seller: '1' },
        { id: '11080', quantity: 1, seller: '1' },
      ],
      postalCode: '31610000',
      country: 'BRA',
    });
  });

  /**
   * The response DROPS what the channel cannot sell — measured live: three SKUs
   * in, two back. Matching positionally against the REQUEST would credit the
   * second SKU's verdict to the third and silently mislabel deliverability.
   */
  it('matches the answer by SKU id, never by position in the request', async () => {
    const deliverable = await deliverableSkus(
      ctxWithPost(answer([{ id: '11080' }], [2])),
      BASE,
      '2',
      '31610-000',
      [{ skuId: '21492', sellerId: '1' }, { skuId: '43238', sellerId: '1' }, ...SKUS],
    );

    // Only the SKU the store actually answered for is deliverable; the dropped
    // ones are absent from the set rather than inheriting a neighbour's verdict.
    expect(deliverable).toEqual(new Set(['11080']));
  });

  it('claims nothing when the simulation cannot answer', async () => {
    const refused = await deliverableSkus(
      ctxWithPost({ ok: false, failure: { kind: 'http', status: 403 } }),
      BASE,
      '2',
      '31610-000',
      SKUS,
    );
    expect(refused).toBeNull();

    const nonsense = await deliverableSkus(
      ctxWithPost({ ok: true, payload: { unexpected: true } }),
      BASE,
      '2',
      '31610-000',
      SKUS,
    );
    // A shape we cannot read is "I could not tell", never "nothing is
    // deliverable" — a wrong delivery claim is the defect this replaced.
    expect(nonsense).toEqual(new Set());
  });

  it('claims nothing when the host mounts no POST seam', async () => {
    const deliverable = await deliverableSkus(
      { logger: silentLogger, fetchJson: () => Promise.resolve(null) },
      BASE,
      '2',
      '31610-000',
      SKUS,
    );
    expect(deliverable).toBeNull();
  });

  it('does not ask about a partial CEP or an empty basket', async () => {
    const captured: Captured = {};
    const ctx = ctxWithPost(answer([{ id: '21492' }], [1]), captured);

    expect(await deliverableSkus(ctx, BASE, '2', '31610', SKUS)).toBeNull();
    expect(await deliverableSkus(ctx, BASE, '2', '31610-000', [])).toBeNull();
    expect(captured.url).toBeUndefined();
  });

  it('omits the channel from the URL when the source configures none', async () => {
    const captured: Captured = {};
    await deliverableSkus(
      ctxWithPost(answer([{ id: '21492' }], [1]), captured),
      `${BASE}/`,
      undefined,
      '31610-000',
      SKUS,
    );
    expect(captured.url).toBe(
      'https://www.apoioentrega.com/api/checkout/pub/orderForms/simulation',
    );
  });
});
