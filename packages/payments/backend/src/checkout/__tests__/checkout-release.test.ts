import { describe, expect, it } from 'vitest';

import { call, setupCheckoutWorld, testAdapter } from './harness';

/**
 * FUT-1146 — a cancelled or refused hosted payment has no terminal state, so
 * the BUYER gets to say so.
 *
 * The finding this route is built on was verified in depth and is worth
 * restating, because it is what rules out every server-only fix: the hosted
 * provider's payment check publishes `success`, `paid`, amounts and NSUs and no
 * status, cancel or decline field; its webhook verifier believes a delivery
 * only once the provider confirms the payment, so an unpaid delivery never
 * reaches a parser; and the poll answers the payable's own status unless the
 * provider says PAID. There is no signal. The buyer is the signal.
 *
 * What these pin is the one property that makes acting on it safe: the buyer's
 * word never outranks the provider's.
 */
describe('POST /release — the buyer did not pay', () => {
  it('lets the payable go when the provider reports no payment', async () => {
    const world = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { hosted: true }) }],
    });
    await call(world.routes, 'POST', '/', {});

    const released = await call(world.routes, 'POST', '/release', { orderId: 'inv_2024_0043' });

    expect(released.status).toBe(200);
    expect(released.body.data).toBe('RELEASED');
    expect(world.correlation.abandons).toEqual(['inv_2024_0043']);
  });

  it('SETTLES instead when the provider says the buyer did pay', async () => {
    // The race the whole design turns on: a webhook still in flight, a buyer
    // who pressed "I could not pay" a second too early. Their word is the
    // reason we ask; the provider's answer is what we act on.
    const world = setupCheckoutWorld({
      chain: [
        {
          name: 'alpha',
          adapter: testAdapter('alpha', {
            hosted: true,
            settledAmount: { amountCents: 7500, currency: 'BRL' },
          }),
        },
      ],
    });
    await call(world.routes, 'POST', '/', {});

    const released = await call(world.routes, 'POST', '/release', { orderId: 'inv_2024_0043' });

    expect(released.body.data).toBe('SETTLED');
    expect(world.correlation.settlements).toHaveLength(1);
    expect(world.correlation.abandons).toEqual([]);
  });

  it('carries the settlement hints, which are the only way to ask at all', async () => {
    // A hosted provider's check refuses to answer without the reference only
    // the paid redirect carries. A release that dropped them would decide "not
    // paid" from a question it was never able to put.
    const world = setupCheckoutWorld({
      chain: [
        {
          name: 'alpha',
          adapter: testAdapter('alpha', {
            hosted: true,
            settledAmount: { amountCents: 7500, currency: 'BRL' },
          }),
        },
      ],
    });
    await call(world.routes, 'POST', '/', {});

    const released = await call(
      world.routes,
      'POST',
      '/release?transactionNsu=nsu-1&slug=abc',
      { orderId: 'inv_2024_0043' },
    );

    expect(released.body.data).toBe('SETTLED');
  });

  it('changes nothing for a payable that already has an answer', async () => {
    const world = setupCheckoutWorld({ payable: { state: 'SETTLED' } });

    const released = await call(world.routes, 'POST', '/release', { orderId: 'inv_2024_0043' });

    expect(released.body.data).toBe('SETTLED');
    expect(world.correlation.abandons).toEqual([]);
  });

  it('releases a payable that never raised a charge at all', async () => {
    // Nothing to ask about and nothing to void — only a payable nobody can
    // pay, which is exactly what a release means.
    const world = setupCheckoutWorld();

    const released = await call(world.routes, 'POST', '/release', { orderId: 'inv_2024_0043' });

    expect(released.body.data).toBe('RELEASED');
    expect(world.correlation.abandons).toEqual(['inv_2024_0043']);
  });

  it('404s a payable that is not this caller-s', async () => {
    const world = setupCheckoutWorld();

    const released = await call(world.routes, 'POST', '/release', { orderId: 'someone-else' });

    expect(released.status).toBe(404);
    expect(world.correlation.abandons).toEqual([]);
  });

  it('answers the payable-s own state for a host that wired no abandon port', async () => {
    // The port is optional, and its absence must not invent a terminal state
    // for somebody else's row. The buyer's screen recovers either way; what is
    // lost is only the server-side tidy-up.
    const world = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { hosted: true }) }],
    });
    const noAbandon = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { hosted: true }) }],
      config: {
        correlation: {
          attachPending: async () => undefined,
          recordCardOutcome: async () => 'CLOSED',
          settle: async () => 'SETTLED',
        },
      },
    });
    await call(world.routes, 'POST', '/', {});
    await call(noAbandon.routes, 'POST', '/', {});

    const released = await call(noAbandon.routes, 'POST', '/release', {
      orderId: 'inv_2024_0043',
    });

    expect(released.status).toBe(200);
    expect(released.body.data).toBe('OPEN');
  });

  it('voids the charge at a provider that can void one', async () => {
    // Where a vendor publishes a void, the difference is between refusing money
    // and refunding it: a hosted link the buyer walked away from stays payable
    // otherwise.
    const world = setupCheckoutWorld({
      chain: [
        { name: 'alpha', adapter: testAdapter('alpha', { hosted: true, cancelable: true }) },
      ],
    });
    await call(world.routes, 'POST', '/', {});

    await call(world.routes, 'POST', '/release', { orderId: 'inv_2024_0043' });

    const stored = await world.charges.latestByReference(
      { kind: 'TENANT', id: 'merchant-1' },
      'inv_2024_0043',
    );
    expect(stored?.snapshot.status).toBe('CANCELED');
    expect(world.correlation.abandons).toEqual(['inv_2024_0043']);
  });

  it('still releases when the provider publishes no void — the ordinary case', async () => {
    // Most vendors implement none, so the adapter throws and the release
    // carries on. A release that failed because a void was unsupported would
    // leave the buyer exactly where this ticket found them.
    const world = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { hosted: true }) }],
    });
    await call(world.routes, 'POST', '/', {});

    const released = await call(world.routes, 'POST', '/release', { orderId: 'inv_2024_0043' });

    expect(released.body.data).toBe('RELEASED');
  });
});
