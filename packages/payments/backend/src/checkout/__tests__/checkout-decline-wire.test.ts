import { describe, expect, it } from 'vitest';

import { call, setupCheckoutWorld, testAdapter } from './harness';

/**
 * FUT-1145 — a card decline is classified server-side and then discarded.
 *
 * The adapters have normalized declines since FUT-340: 33 published codes plus
 * their issuer sub-reasons, each carrying the vendor's own "may this be tried
 * again" verdict. `/charge` answered `{ status }` and threw all of it away, so
 * an expired card, a card reported stolen, no funds, a cancelled recurring
 * mandate and "attempts exhausted — DO NOT RETRY" reached the buyer as one
 * sentence with one button, and pressing it produced the identical refusal plus
 * a second failed order in their history.
 *
 * These pin the wire, in both directions: the classification travels, and it
 * travels ONLY where it is true.
 */

const CARD_PAYABLE = { method: 'CARD' as const };

describe('POST /charge — what a refusal tells the buyer', () => {
  it('carries the reason and the retry verdict', async () => {
    const world = setupCheckoutWorld({
      payable: CARD_PAYABLE,
      chain: [
        {
          name: 'alpha',
          adapter: testAdapter('alpha', {
            declines: { reason: 'EXPIRED_CARD', retriable: false },
          }),
        },
      ],
    });

    const charged = await call(world.routes, 'POST', '/charge', {
      orderId: 'inv_2024_0043',
      token: 'tok_fresh',
      saveCard: false,
    });

    expect(charged.status).toBe(200);
    expect(charged.body.data).toMatchObject({ declineReason: 'EXPIRED_CARD', retriable: false });
  });

  it('hands the retry verdict to the host, which is the half only it can act on', async () => {
    // A retriable decline is a buyer still trying to buy this. The host is the
    // only side that can leave the payable chargeable so the next instrument
    // goes against the SAME order rather than a freshly minted one.
    const world = setupCheckoutWorld({
      payable: CARD_PAYABLE,
      chain: [
        {
          name: 'alpha',
          adapter: testAdapter('alpha', {
            declines: { reason: 'INSUFFICIENT_FUNDS', retriable: true },
          }),
        },
      ],
    });

    await call(world.routes, 'POST', '/charge', {
      orderId: 'inv_2024_0043',
      token: 'tok_fresh',
      saveCard: false,
    });

    expect(world.correlation.cardOutcomes[0]).toMatchObject({
      approved: false,
      retriable: true,
    });
    // …and the harness host acts on it exactly as an adopting host should: the
    // payable is still chargeable, so a second instrument can be tried on it.
    expect(world.world.payable.state).toBe('OPEN');
  });

  it('says nothing about a decline when the adapter classified none', async () => {
    // The degrade direction. An adapter that publishes no reason produces the
    // wire this route always answered, and every client renders what it always
    // rendered.
    const world = setupCheckoutWorld({
      payable: CARD_PAYABLE,
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { declines: { reason: 'UNKNOWN' } }) }],
    });

    const charged = await call(world.routes, 'POST', '/charge', {
      orderId: 'inv_2024_0043',
      token: 'tok_fresh',
      saveCard: false,
    });

    expect(charged.body.data).toMatchObject({ declineReason: 'UNKNOWN' });
    expect(charged.body.data).not.toHaveProperty('retriable');
  });

  it('carries NO decline shape on an approved charge', async () => {
    // A charge that went through has no reason and no verdict, and a client
    // that met either would have something to render for a payment that worked.
    const world = setupCheckoutWorld({ payable: CARD_PAYABLE });

    const charged = await call(world.routes, 'POST', '/charge', {
      orderId: 'inv_2024_0043',
      token: 'tok_fresh',
      saveCard: false,
    });

    expect(charged.body.data).not.toHaveProperty('declineReason');
    expect(charged.body.data).not.toHaveProperty('retriable');
    expect(world.correlation.cardOutcomes[0]).toMatchObject({ approved: true });
    expect(world.correlation.cardOutcomes[0]).not.toHaveProperty('retriable');
  });
  it('keeps the payable chargeable after a card-data refusal PagBank marks not retriable (FUT-4401)', async () => {
    // 20007 — the buyer mistyped the CVV. "Do not retry" is about resending
    // the identical card data; the corrected card goes against the SAME
    // payable, so the host is told to leave it open.
    const world = setupCheckoutWorld({
      payable: CARD_PAYABLE,
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { declines: { reason: 'INVALID_CARD', retriable: false } }) }],
    });

    const charged = await call(world.routes, 'POST', '/charge', { orderId: 'inv_2024_0043', token: 'tok_fresh', saveCard: false });

    // The wire still says what PagBank said: the same card may not be resent.
    expect(charged.body.data).toMatchObject({ declineReason: 'INVALID_CARD', retriable: false });
    expect(world.correlation.cardOutcomes[0]).toMatchObject({ approved: false, retriable: false, keepsPayableOpen: true });
    expect(world.world.payable.state).toBe('OPEN');
  });

  it('closes the payable on a refusal that is neither retriable nor about card data', async () => {
    const world = setupCheckoutWorld({
      payable: CARD_PAYABLE,
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { declines: { reason: 'FRAUD_SUSPECTED', retriable: false } }) }],
    });

    await call(world.routes, 'POST', '/charge', { orderId: 'inv_2024_0043', token: 'tok_fresh', saveCard: false });

    expect(world.correlation.cardOutcomes[0]).toMatchObject({ approved: false, keepsPayableOpen: false });
    expect(world.world.payable.state).toBe('CLOSED');
  });

  it('tells the host nothing about the payable on an approved charge', async () => {
    const world = setupCheckoutWorld({ payable: CARD_PAYABLE });

    await call(world.routes, 'POST', '/charge', { orderId: 'inv_2024_0043', token: 'tok_fresh', saveCard: false });

    expect(world.correlation.cardOutcomes[0]).not.toHaveProperty('keepsPayableOpen');
  });
});
