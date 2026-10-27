import { describe, expect, it } from 'vitest';

import { stubPendingSnapshot } from '../../providers/shared';

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

/** Every PENDING charge but the buyer's answer must carry the supersede mark. */
function unaccounted(scene: ReturnType<typeof parkedHostedWorld>, answer: string): string[] {
  return scene.charges
    .all()
    .filter((row) => row.snapshot.status === 'PENDING' && !row.snapshot.superseded)
    .map((row) => row.providerChargeId)
    .filter((id) => id !== answer);
}

describe('a superseded link is never handed back (flip, raise, flip back, re-tap)', () => {
  const cases = (['PIX', 'CARD'] as const).flatMap((method) =>
    ([false, 'fails', 'pending'] as const).map((alphaVoids) => ({
      name: `method=${method} alphaVoids=${String(alphaVoids)}`,
      method,
      alphaVoids,
    })),
  );

  it.each(cases)('$name', async ({ method, alphaVoids }) => {
    const scene = parkedHostedWorld({ alphaVoids });
    const card = method === 'CARD' ? { tokensByProvider: { beta: 'tok_beta' } } : undefined;
    const link = await scene.park('parked');
    scene.credentials.chain = ['beta', 'alpha'];
    const second = await scene.pay(method, card);
    scene.credentials.chain = ['alpha', 'beta'];

    const third = await scene.pay(method, card);
    const fourth = await scene.pay(method, card);

    expect(second.provider).toBe('beta');
    for (const answer of [third, fourth]) {
      expect(answer.providerChargeId).not.toBe(link?.providerChargeId);
      expect(unaccounted(scene, answer.providerChargeId)).toEqual([]);
    }
    // The old link was retired ONCE, however many attempts met it afterwards.
    expect(scene.superseded.map((s) => s.snapshot.providerChargeId)).toEqual([link?.providerChargeId]);
  });
});

describe('a moved-past link is retired once', () => {
  it('two raises after a flip: one record, one void attempt', async () => {
    const world = parkedHostedWorld({ alphaVoids: 'fails' });
    await world.park('parked');
    world.credentials.chain = ['beta', 'alpha'];
    const card = { tokensByProvider: { beta: 'tok_beta' } };

    await world.pay('CARD', card);
    await world.pay('CARD', card);

    expect(world.superseded).toHaveLength(1);
    expect(world.reports.filter((r) => r.path === 'CANCEL')).toHaveLength(1);
    expect(world.logs.error.filter((line) => line.includes('payments.void failed'))).toHaveLength(1);
  });

  it('a provider with no void is asked once too', async () => {
    const world = parkedHostedWorld({ alphaVoids: false });
    await world.park('parked');
    world.credentials.chain = ['beta', 'alpha'];

    await world.pay('CARD', { tokensByProvider: { beta: 'tok_beta' } });
    await world.pay('CARD', { tokensByProvider: { beta: 'tok_beta' } });

    expect(world.superseded.map((s) => s.why)).toEqual(['VOID_UNSUPPORTED']);
    expect(world.logs.warn.filter((line) => line.includes('payments.void unsupported'))).toHaveLength(1);
  });
});

describe('a void the provider answers with a payment (PAID_BEFORE_VOID)', () => {
  it('answers with the PAID link, and retires the charge it was about to hand out', async () => {
    const world = parkedHostedWorld({ alphaVoids: 'paid' });
    const link = await world.park('parked');
    world.credentials.chain = ['beta', 'alpha'];

    const held = await world.payHeld('PIX');

    expect(held.paidEarlier).toBe(true);
    expect([held.answer.providerChargeId, held.answer.status]).toEqual([link?.providerChargeId, 'PAID']);
    // beta's fresh QR cannot be voided here, so it is marked and recorded —
    // replaced by the payment the buyer already made.
    const fresh = world.charges.all().find((row) => row.provider === 'beta');
    expect(
      world.superseded.map((s) => [s.snapshot.providerChargeId, s.replacedBy.providerChargeId, s.why, s.voidOutcome]),
    ).toEqual([[fresh?.providerChargeId, link?.providerChargeId, 'PAID_ELSEWHERE', 'VOID_UNSUPPORTED']]);
    expect(fresh?.snapshot.superseded?.replacedBy).toBe(link?.providerChargeId);
    expect(world.reports.map((r) => [r.path, r.severity, r.provider])).toEqual([['CANCEL', 'error', 'alpha']]);
    expect(world.statusOf(link ?? held.answer)).toBe('PAID');
    expect(world.logs.error.some((line) => line.includes('PAID_BEFORE_VOID'))).toBe(true);
  });

  it('through the checkout: the payable is SETTLED with the paid link, and the buyer sees no new QR', async () => {
    const paidOnVoid = testAdapter('alpha', { tokenization: 'REDIRECT', hosted: true });
    const world = setupCheckoutWorld({
      chain: [
        {
          name: 'alpha',
          adapter: {
            ...paidOnVoid,
            async cancelCharge(providerChargeId: string) {
              return { ...stubPendingSnapshot('alpha', providerChargeId), status: 'PAID' as const, amount: BRL(7500) };
            },
          },
        },
        browserBeta,
      ],
    });
    await call(world.routes, 'POST', '/', {});
    const link = world.correlation.pending[0]?.charge.providerChargeId;

    world.credentials.setChain(MERCHANT, ['beta', 'alpha']);
    const paid = await call(world.routes, 'POST', '/', {});

    expect(paid.status).toBe(200);
    expect(dataOf(paid).hostedCheckoutUrl).toBeUndefined();
    expect(dataOf(paid).state).toBe('SETTLED');
    expect(world.correlation.settlements).toEqual([{ ref: REF, capturedAmount: BRL(7500) }]);
    // Only the first link was ever attached; beta's fresh QR never reached the buyer.
    expect(world.correlation.pending.map((p) => p.charge.providerChargeId)).toEqual([link]);
    expect(world.correlation.superseded.map((s) => [s.charge.provider, s.replacedBy.providerChargeId])).toEqual([
      ['beta', link],
    ]);
  });

  it('a card PAID in this request while the old link was paid too: DOUBLE_PAID, the card is the answer', async () => {
    const world = parkedHostedWorld({ alphaVoids: 'paid' });
    const link = await world.park('parked');
    world.credentials.chain = ['beta', 'alpha'];

    const held = await world.payHeld('CARD', { tokensByProvider: { beta: 'tok_beta' } });

    expect([held.answer.provider, held.answer.status, held.paidEarlier]).toEqual(['beta', 'PAID', false]);
    expect(world.superseded.map((s) => [s.snapshot.providerChargeId, s.replacedBy.providerChargeId, s.why])).toEqual([
      [link?.providerChargeId, held.answer.providerChargeId, 'DOUBLE_PAID'],
    ]);
    const old = world.charges.all().find((row) => row.providerChargeId === link?.providerChargeId);
    expect([old?.snapshot.status, old?.snapshot.superseded?.why]).toEqual(['PAID', 'DOUBLE_PAID']);
    expect(world.reports.some((r) => r.message.includes('BOTH paid'))).toBe(true);
  });

  it('through the checkout: a double-paid card is recorded approved, never settled with the old link', async () => {
    const paidOnVoid = testAdapter('alpha', { tokenization: 'REDIRECT', hosted: true });
    const world = setupCheckoutWorld({
      chain: [
        {
          name: 'alpha',
          adapter: {
            ...paidOnVoid,
            async cancelCharge(providerChargeId: string) {
              return { ...stubPendingSnapshot('alpha', providerChargeId), status: 'PAID' as const, amount: BRL(7500) };
            },
          },
        },
        browserBeta,
      ],
      payable: { method: 'CARD' },
    });
    const card = { orderId: REF, card: { tokensByProvider: { beta: 'tok_beta' } } };
    await call(world.routes, 'POST', '/charge', card);
    const link = world.correlation.pending[0]?.charge.providerChargeId;

    world.credentials.setChain(MERCHANT, ['beta', 'alpha']);
    const paid = await call(world.routes, 'POST', '/charge', card);

    expect(paid.status).toBe(200);
    expect(world.correlation.cardOutcomes).toEqual([{ ref: REF, approved: true, amount: BRL(7500) }]);
    expect(world.correlation.settlements).toEqual([]);
    expect(world.correlation.superseded.map((s) => [s.charge.providerChargeId, s.replacedBy.provider, s.why])).toEqual([
      [link, 'beta', 'DOUBLE_PAID'],
    ]);
  });

  it('records VOID_NOT_CONFIRMED when the void leaves it PENDING', async () => {
    const world = parkedHostedWorld({ alphaVoids: 'pending' });
    await world.park('parked');
    world.credentials.chain = ['beta', 'alpha'];

    await world.pay('PIX');

    expect(world.superseded.map((s) => s.why)).toEqual(['VOID_NOT_CONFIRMED']);
  });
});

describe('an outage at the head: reuse lasts as long as the outage (FUT-563 + FUT-604)', () => {
  it('re-taps while the head is still down reuse the link the failover minted', async () => {
    const world = parkedHostedWorld({ alphaVoids: false });
    world.credentials.chain = ['beta', 'alpha'];
    world.beta.down = true;
    const link = await world.pay('PIX');

    const again = await world.pay('PIX');
    const thrice = await world.pay('PIX');

    expect(link.provider).toBe('alpha');
    expect([again.providerChargeId, thrice.providerChargeId]).toEqual([link.providerChargeId, link.providerChargeId]);
    expect(world.charges.all()).toHaveLength(1);
    expect(world.superseded).toEqual([]);
  });

  it('reuses the link while the head\'s breaker is still open, even with the head answering again', async () => {
    const world = parkedHostedWorld({ alphaVoids: false });
    const link = await world.park('outage');
    world.credentials.chain = ['beta', 'alpha'];

    expect((await world.pay('PIX')).providerChargeId).toBe(link?.providerChargeId);
    expect(world.charges.all()).toHaveLength(1);
  });

  it('once the head is back, walks the chain to it and retires the link', async () => {
    const world = parkedHostedWorld({ alphaVoids: false });
    const link = await world.park('outage');
    world.credentials.chain = ['beta', 'alpha'];
    world.recover();

    const got = await world.pay('PIX');

    expect(got.provider).toBe('beta');
    expect(world.superseded.map((s) => [s.snapshot.providerChargeId, s.why])).toEqual([
      [link?.providerChargeId, 'VOID_UNSUPPORTED'],
    ]);
  });

  it('a CARD re-tap does not reuse a link a PIX walk minted — the ledger is per method', async () => {
    const world = parkedHostedWorld({ alphaVoids: false });
    const link = await world.park('outage');
    world.credentials.chain = ['beta', 'alpha'];

    const got = await world.pay('CARD', { tokensByProvider: { beta: 'tok_beta' } });

    // beta is still breaker-skipped, so the walk lands on alpha again — a new link.
    expect(got.provider).toBe('alpha');
    expect(got.providerChargeId).not.toBe(link?.providerChargeId);
  });
});

describe('the links not reused are retired on the REUSE path too', () => {
  it('a re-tap that reuses a live QR retires a stray hosted link against it', async () => {
    const world = parkedHostedWorld({ alphaVoids: false });
    world.credentials.chain = ['beta', 'alpha'];
    const qr = await world.pay('PIX');
    await world.charges.create({
      merchant: MERCHANT,
      reference: `${world.payable.ref}--9`,
      idempotencyKey: `${world.payable.ref}:9`,
      snapshot: {
        provider: 'alpha',
        providerChargeId: 'stray_alpha',
        status: 'PENDING',
        amount: world.payable.amount,
        method: 'PIX',
        hostedCheckoutUrl: 'https://alpha.example/checkout/stray_alpha',
      },
    });

    const again = await world.pay('PIX');

    expect(again.providerChargeId).toBe(qr.providerChargeId);
    expect(world.superseded.map((s) => [s.snapshot.providerChargeId, s.replacedBy.providerChargeId])).toEqual([
      ['stray_alpha', qr.providerChargeId],
    ]);
    expect(unaccounted(world, qr.providerChargeId)).toEqual([]);
  });
});
