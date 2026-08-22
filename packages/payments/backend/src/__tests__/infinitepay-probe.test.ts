import { afterEach, describe, expect, it, vi } from 'vitest';

import { infinitePayProvider } from '../providers/infinitepay';
import { PT_BR_INFINITEPAY_COPY } from '../providers/pt-BR';

/**
 * The InfinitePay RECONCILIATION PROBE, and the one distinction it exists to
 * make: does a PAYMENT exist?
 *
 * `payment_check` answers a live handle with `200 {"success": false}` when
 * nobody has paid — the very same body `verifyCredentials` reads as "the handle
 * is real" (see `infinitepay-verify.test.ts`). That answer is proof no money
 * moved, and the probe must report it as NO CHARGE.
 *
 * It used to report a snapshot instead, and the snapshot said `PENDING`. The
 * walk reads `PENDING` as live money, so an ambiguous first attempt ADOPTED an
 * answer meaning the opposite and persisted it. What it persisted was unpayable
 * by construction — 0 cents, no hosted link, and a `providerChargeId` falling
 * back to our own reference — and because InfinitePay names its charge after
 * that reference, the row then owned `(provider, providerChargeId)` for the
 * whole order. Every later attempt collided with it and was refused by the
 * identity guard, so the buyer got CHARGE_MISMATCH on every retry, forever,
 * with nothing recorded and nothing to reconcile.
 */
describe('infinitepay findChargeByReference', () => {
  const CREDS = { environment: 'PRODUCTION' as const, fields: { handle: '$loja' }, stub: false };
  const HINTS = { slug: 'inv_slug', transactionNsu: 'tx_1' };
  const REFERENCE = '89e40634-0e64-4e14-be9a-e337c621cf00';

  const answerWith = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );

  afterEach(() => vi.unstubAllGlobals());

  const probe = () =>
    infinitePayProvider(PT_BR_INFINITEPAY_COPY).findChargeByReference!(REFERENCE, CREDS, HINTS);

  it('answers NO CHARGE when the handle is live and nobody has paid', async () => {
    // `200 {"success": false}` — a real handle, no payment. The exact body the
    // production incident adopted as a live PENDING charge.
    answerWith(200, { success: false });
    await expect(probe()).resolves.toBeNull();
  });

  it('answers NO CHARGE for an explicit paid:false too', async () => {
    answerWith(200, { success: false, paid: false, order_nsu: REFERENCE });
    await expect(probe()).resolves.toBeNull();
  });

  it('never hands back the unpayable row the old mapping produced', async () => {
    // Belt and braces on the THREE properties that made it fatal, so a future
    // refactor that reinstates the snapshot fails here with a readable reason
    // rather than in a store's checkout weeks later.
    answerWith(200, { success: false });
    const found = await probe();
    expect(found?.amount.amountCents).not.toBe(0);
    expect(found?.providerChargeId).not.toBe(REFERENCE);
    expect(found).toBeNull();
  });

  it('reports a real payment as PAID', async () => {
    answerWith(200, {
      success: true,
      order_nsu: REFERENCE,
      transaction_nsu: 'tx_9',
      amount: 1290,
      capture_method: 'credit_card',
    });
    await expect(probe()).resolves.toMatchObject({
      status: 'PAID',
      method: 'CARD',
      amount: { amountCents: 1290, currency: 'BRL' },
    });
  });

  it('still proves "nothing was charged" on the 404/422 branch', async () => {
    answerWith(404, { success: false, message: 'Not found' });
    await expect(probe()).resolves.toBeNull();
    answerWith(422, { success: false });
    await expect(probe()).resolves.toBeNull();
  });

  it('lets an outage PROPAGATE rather than calling it "nothing was charged"', async () => {
    // The safety property the walk depends on: a provider that did not answer
    // must stop the walk, never authorize a second charge elsewhere.
    answerWith(503, { message: 'unavailable' });
    await expect(probe()).rejects.toThrow();
  });
});

/**
 * The deliberate asymmetry. `getCharge` answers a different question — what is
 * this order's STATE — and "not paid yet" is the honest answer to the buyer's
 * poll. Collapsing the two is what the probe fix must not do.
 */
describe('infinitepay getCharge keeps the PENDING mapping', () => {
  const CREDS = { environment: 'PRODUCTION' as const, fields: { handle: '$loja' }, stub: false };

  afterEach(() => vi.unstubAllGlobals());

  it('reports an unpaid order as PENDING, not as absent', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(
      infinitePayProvider(PT_BR_INFINITEPAY_COPY).getCharge('order-1', CREDS, { slug: 's', transactionNsu: 't' }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });
});
