import { describe, expect, it } from 'vitest';

import { BRL, call, setupCheckoutWorld, testAdapter } from './harness';

const REF = 'inv_2024_0043';
const STATUS = `/status?orderId=${REF}`;

/**
 * THE POLL — a GET that can SETTLE.
 *
 * The webhook is the primary confirmation path, but a dropped or delayed
 * delivery would strand a genuinely-paid payable forever, so this re-reads the
 * charge from the provider and applies it through the host's own idempotent
 * confirmation. Everything that makes that safe is asserted here.
 */
describe('the settlement poll', () => {
  it('answers a terminal payable from the host token, asking no provider', async () => {
    const world = setupCheckoutWorld({ payable: { state: 'SETTLED' } });
    const { body } = await call(world.routes, 'GET', STATUS);
    expect(body.data).toBe('SETTLED');
    expect(world.correlation.settlements).toEqual([]);
  });

  it('answers 404 for a handle this caller cannot load', async () => {
    const world = setupCheckoutWorld();
    const { status, body } = await call(world.routes, 'GET', '/status?orderId=someone-elses');
    // "Absent" and "not yours" are deliberately indistinguishable.
    expect(status).toBe(404);
    expect(body.code).toBe('PAYABLE_NOT_FOUND');
  });

  it('settles with the amount the PROVIDER reported, never the payable total', async () => {
    const world = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { settledAmount: BRL(7400) }) }],
    });
    await call(world.routes, 'POST', '/', {});
    const { body } = await call(world.routes, 'GET', STATUS);

    expect(body.data).toBe('SETTLED');
    // FUT-373 — echoing our own 7500 back would settle any capture however
    // small, and would make the host's shortfall guard compare a number with
    // itself. The 100-cent shortfall has to reach the host to be caught.
    expect(world.correlation.settlements).toEqual([
      { ref: REF, capturedAmount: BRL(7400) },
    ]);
  });

  it('leaves the payable alone when the provider says it is still unpaid', async () => {
    const world = setupCheckoutWorld();
    await call(world.routes, 'POST', '/', {});
    const { body } = await call(world.routes, 'GET', STATUS);
    expect(body.data).toBe('OPEN');
    expect(world.correlation.settlements).toEqual([]);
  });

  it('survives a provider outage without breaking the polling screen', async () => {
    const world = setupCheckoutWorld();
    await call(world.routes, 'POST', '/', {});
    world.gateway.refreshCharge = async () => {
      throw new Error('provider unreachable');
    };

    const { status, body } = await call(world.routes, 'GET', STATUS);
    expect(status).toBe(200);
    expect(body.data).toBe('OPEN');
    expect(world.correlation.settlements).toEqual([]);
  });

  it('answers from the payable alone when no charge was ever raised', async () => {
    const world = setupCheckoutWorld();
    const { body } = await call(world.routes, 'GET', STATUS);
    // No charge means nothing was ever raised, so nothing can be confirmed —
    // a missing connection is emphatically not permission to declare it paid.
    expect(body.data).toBe('OPEN');
  });

  it('self-settles a STUB charge on the offline timeline, at the PAYABLE amount', async () => {
    const world = setupCheckoutWorld({ offlineSettlement: { afterMs: 0 } });
    await call(world.routes, 'POST', '/', {});
    const { body } = await call(world.routes, 'GET', STATUS);

    expect(body.data).toBe('SETTLED');
    // FUT-374 — the stub snapshot hardcodes a zero amount, so forwarding IT
    // would park every dev/CI payable as a short payment and take the offline
    // timeline out of service. The library decides which of the two, not the host.
    expect(world.correlation.settlements).toEqual([
      { ref: REF, capturedAmount: BRL(7500) },
    ]);
  });

  it('expires a payable whose PIX window lapsed, when the host offers expiry', async () => {
    const lapsed = testAdapter('alpha');
    const world = setupCheckoutWorld({
      chain: [
        {
          name: 'alpha',
          adapter: {
            ...lapsed,
            createCharge: async (input, credentials) => ({
              ...(await lapsed.createCharge(input, credentials)),
              // A fixed instant safely in the past — the window has demonstrably
              // lapsed without the assertion depending on when the test ran.
              pix: { qrText: 'qr', expiresAt: '2020-01-01T00:00:00.000Z' },
            }),
          },
        },
      ],
    });
    await call(world.routes, 'POST', '/', {});
    const { body } = await call(world.routes, 'GET', STATUS);

    expect(body.data).toBe('EXPIRED');
    expect(world.correlation.expiries).toEqual([REF]);
  });
});

/**
 * THE PORTABILITY ASSERTIONS.
 *
 * The first is the falsifiable half of `Payable`: the whole flow is driven
 * against an INVOICE, with no order semantics in the fixture at all. If this
 * needed anything order-shaped, the port would be an order in disguise.
 */
describe('the library knows nothing about orders or vendors', () => {
  it('drives create → charge → status against a payable that is an invoice', async () => {
    const world = setupCheckoutWorld({
      payable: { ref: 'inv_2024_0043', method: 'CARD' },
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { settledAmount: BRL(7500) }) }],
    });

    expect((await call(world.routes, 'POST', '/', {})).status).toBe(200);
    const charged = await call(world.routes, 'POST', '/charge', {
      orderId: 'inv_2024_0043',
      card: { token: 'tok_ok' },
    });
    expect(charged.status).toBe(200);
    expect((charged.body.data as Record<string, unknown>).status).toBe('SETTLED');
    expect((await call(world.routes, 'GET', STATUS)).body.data).toBe('SETTLED');
  });

  it('names no provider in any body but the config read', async () => {
    const world = setupCheckoutWorld({
      chain: [
        { name: 'alpha', adapter: testAdapter('alpha') },
        { name: 'beta', adapter: testAdapter('beta') },
      ],
    });
    const bodies = [
      (await call(world.routes, 'POST', '/', {})).body,
      (await call(world.routes, 'GET', STATUS)).body,
      (await call(world.routes, 'GET', '/cards')).body,
    ];
    for (const body of bodies) {
      expect(JSON.stringify(body)).not.toMatch(/alpha|beta/);
    }
    // The config read is the one place a provider name is legitimate: the
    // browser has to know whose protocol to speak.
    expect(JSON.stringify((await call(world.routes, 'GET', '/config')).body)).toContain('alpha');
  });
});
