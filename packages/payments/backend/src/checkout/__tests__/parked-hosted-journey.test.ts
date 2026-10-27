import { describe, expect, it } from 'vitest';

import { BRL, MERCHANT, call, setupCheckoutWorld, testAdapter } from './harness';
import { parkedHostedWorld } from './parked-hosted-world';

/**
 * FUT-4072 — THE TRAPPED PAYABLE, END TO END THROUGH THE CHECKOUT FLOWS.
 *
 * Production: a payable was opened while the store's chain read
 * `[hosted, in-browser]` and a hosted link was minted for it. The owner then
 * reordered the chain to `[in-browser, hosted]`, and every attempt to pay —
 * card typed on the page, or PIX — still sent the buyer to the hosted page,
 * because the FUT-604 reuse handed back any still-payable link. The payable was
 * trapped on a provider the store no longer routes to first.
 *
 * Here `alpha` is the hosted provider (it cannot void a charge, like the one in
 * production) and `beta` tokenizes in the browser.
 */

const REF = 'inv_2024_0043';

const hostedAlpha = (cancelable = false) => ({
  name: 'alpha',
  adapter: testAdapter('alpha', { tokenization: 'REDIRECT', hosted: true, cancelable }),
});
const browserBeta = { name: 'beta', adapter: testAdapter('beta') };

function dataOf(response: { body: Record<string, unknown> }): Record<string, unknown> {
  return response.body.data as Record<string, unknown>;
}

function statusOf(world: ReturnType<typeof setupCheckoutWorld>, providerChargeId: string) {
  return world.charges.all().find((row) => row.providerChargeId === providerChargeId)?.snapshot.status;
}

describe('a PIX payable parked on a hosted link, chain flipped', () => {
  it('sends the buyer to the provider now first, and records the old link superseded', async () => {
    const world = setupCheckoutWorld({ chain: [hostedAlpha(), browserBeta] });
    const parked = await call(world.routes, 'POST', '/', {});
    expect(String(dataOf(parked).hostedCheckoutUrl)).toContain('alpha.example');
    const link = world.correlation.pending[0]?.charge;

    world.credentials.setChain(MERCHANT, ['beta', 'alpha']);
    const paid = await call(world.routes, 'POST', '/', {});

    // The buyer gets beta's QR, not alpha's page.
    expect(paid.status).toBe(200);
    expect(dataOf(paid).hostedCheckoutUrl).toBeUndefined();
    expect(world.correlation.pending.at(-1)?.charge.provider).toBe('beta');
    // alpha cannot void, so its link is recorded — never left payable unnoticed.
    expect(world.correlation.superseded).toEqual([
      {
        ref: REF,
        charge: link,
        replacedBy: world.correlation.pending.at(-1)?.charge,
        why: 'VOID_UNSUPPORTED',
      },
    ]);
  });

  it('voids the old link instead when the hosted provider can', async () => {
    const world = setupCheckoutWorld({ chain: [hostedAlpha(true), browserBeta] });
    await call(world.routes, 'POST', '/', {});
    const link = world.correlation.pending[0]?.charge.providerChargeId ?? '';

    world.credentials.setChain(MERCHANT, ['beta', 'alpha']);
    await call(world.routes, 'POST', '/', {});

    expect(statusOf(world, link)).toBe('CANCELED');
    expect(world.correlation.superseded).toEqual([]);
  });
});

describe('a CARD payable parked on a hosted link, chain flipped', () => {
  it('charges the card the buyer typed at the provider now first', async () => {
    const world = setupCheckoutWorld({
      chain: [hostedAlpha(), browserBeta],
      payable: { method: 'CARD' },
    });
    const card = { orderId: REF, card: { tokensByProvider: { beta: 'tok_beta' } } };
    const first = await call(world.routes, 'POST', '/charge', card);
    expect(String(dataOf(first).hostedCheckoutUrl)).toContain('alpha.example');

    world.credentials.setChain(MERCHANT, ['beta', 'alpha']);
    const second = await call(world.routes, 'POST', '/charge', card);

    expect(second.status).toBe(200);
    expect(dataOf(second).hostedCheckoutUrl).toBeUndefined();
    expect(world.correlation.cardOutcomes).toEqual([{ ref: REF, approved: true, amount: BRL(7500) }]);
    expect(world.correlation.superseded).toHaveLength(1);
    expect(world.correlation.superseded[0]?.charge.provider).toBe('alpha');
    expect(world.correlation.superseded[0]?.replacedBy.provider).toBe('beta');
  });

  it('keeps the link when the new card is DECLINED — the buyer still has something to pay', async () => {
    const world = setupCheckoutWorld({
      chain: [
        hostedAlpha(true),
        { name: 'beta', adapter: testAdapter('beta', { declines: { reason: 'CARD_DECLINED' } }) },
      ],
      payable: { method: 'CARD' },
    });
    const card = { orderId: REF, card: { tokensByProvider: { beta: 'tok_beta' } } };
    await call(world.routes, 'POST', '/charge', card);
    const link = world.correlation.pending[0]?.charge.providerChargeId ?? '';

    world.credentials.setChain(MERCHANT, ['beta', 'alpha']);
    await call(world.routes, 'POST', '/charge', card);

    expect(world.correlation.cardOutcomes[0]?.approved).toBe(false);
    expect(statusOf(world, link)).toBe('PENDING');
    expect(world.correlation.superseded).toEqual([]);
  });
});

describe('FUT-604 still holds on an unchanged chain', () => {
  it('a PIX re-tap hands back the same link and raises nothing', async () => {
    const world = setupCheckoutWorld({ chain: [hostedAlpha(true), browserBeta] });
    const first = await call(world.routes, 'POST', '/', {});
    const second = await call(world.routes, 'POST', '/', {});

    expect(dataOf(second).hostedCheckoutUrl).toBe(dataOf(first).hostedCheckoutUrl);
    expect(world.charges.all()).toHaveLength(1);
    expect(world.correlation.superseded).toEqual([]);
  });

  it('a CARD re-tap with no instrument for the hosted provider hands back the same link', async () => {
    const world = setupCheckoutWorld({ chain: [hostedAlpha(true), browserBeta], payable: { method: 'CARD' } });
    const card = { orderId: REF, card: { tokensByProvider: { beta: 'tok_beta' } } };
    const first = await call(world.routes, 'POST', '/charge', card);
    const second = await call(world.routes, 'POST', '/charge', card);

    expect(dataOf(second).hostedCheckoutUrl).toBe(dataOf(first).hostedCheckoutUrl);
    expect(world.charges.all()).toHaveLength(1);
    expect(world.correlation.cardOutcomes).toEqual([]);
  });

  it('a hosted provider moved to second place but still first for the method is still reused', async () => {
    const world = setupCheckoutWorld({
      chain: [hostedAlpha(), { name: 'beta', adapter: testAdapter('beta', { methods: ['CARD'] }) }],
    });
    const first = await call(world.routes, 'POST', '/', {});

    // beta now heads the chain but cannot take PIX: a PIX walk still lands on alpha.
    world.credentials.setChain(MERCHANT, ['beta', 'alpha']);
    const second = await call(world.routes, 'POST', '/', {});

    expect(dataOf(second).hostedCheckoutUrl).toBe(dataOf(first).hostedCheckoutUrl);
    expect(world.charges.all()).toHaveLength(1);
  });
});

describe('a void that fails never blocks the buyer', () => {
  it('reports the refusal to onProviderFailure, records the link superseded, and answers with the new charge', async () => {
    const world = parkedHostedWorld({ alphaVoids: 'fails' });
    const parked = await world.park('parked');
    world.credentials.chain = ['beta', 'alpha'];

    const got = await world.pay('PIX');

    expect(got.provider).toBe('beta');
    expect(got.status).toBe('PENDING');
    expect(world.reports.map((r) => [r.path, r.provider, r.httpStatus])).toEqual([['CANCEL', 'alpha', 502]]);
    expect(world.superseded.map((s) => [s.snapshot.providerChargeId, s.why])).toEqual([
      [parked?.providerChargeId, 'VOID_FAILED'],
    ]);
    expect(world.logs.error.some((line) => line.includes('payments.void failed'))).toBe(true);
  });

  it('a disabled hosted provider is moved past too, and its unvoidable link recorded', async () => {
    const world = parkedHostedWorld({ alphaVoids: true });
    const parked = await world.park('parked');
    world.credentials.alpha = 'disabled';

    const got = await world.pay('CARD', { tokensByProvider: { beta: 'tok_beta' } });

    expect(got.provider).toBe('beta');
    expect(world.statusOf(parked ?? got)).toBe('PENDING');
    expect(world.superseded.map((s) => s.why)).toEqual(['VOID_FAILED']);
  });
});
