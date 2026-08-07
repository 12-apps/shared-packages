import { describe, expect, it } from 'vitest';

import { BRL, call, setupCheckoutWorld, testAdapter } from './harness';

const REF = 'inv_2024_0043';

/**
 * THE MONEY RULES, driven through HTTP.
 *
 * Every one of these was a production defect in a host that re-derived the rule
 * for itself. Asserting them at the mount — rather than at the function that
 * implements each — is what makes a routing regression unable to quietly undo
 * one: the rule is only worth anything if it fires on the path a buyer takes.
 */

describe('the browser cannot name the price', () => {
  it('charges the PAYABLE amount under the library\'s own reference and key', async () => {
    const world = setupCheckoutWorld({ payable: { method: 'CARD' } });
    await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      // Everything a hostile client could try to decide for itself.
      amount: { amountCents: 1, currency: 'BRL' },
      reference: 'someone-elses-invoice',
      idempotencyKey: 'attacker-chosen',
      card: { token: 'tok_ok' },
    });

    const [stored] = world.charges.all();
    expect(stored?.snapshot.amount).toEqual(BRL(7500));
    // Attempt 0 keeps the bare handle; the key is `<ref>:<attempt>`, computed
    // from the persisted count and never from the request.
    expect(stored?.reference).toBe(REF);
    expect(stored?.idempotencyKey).toBe(`${REF}:0`);
  });

  it('bumps the attempt on the SECOND charge, so a reprice cannot reuse a QR', async () => {
    const world = setupCheckoutWorld({ payable: { method: 'CARD' } });
    const body = { orderId: REF, card: { token: 'tok_ok' } };
    await call(world.routes, 'POST', '/charge', body);
    // The stub authorizes, so the host's correlation port settled the payable.
    // Reopened here because what is under test is the ATTEMPT ORDINAL, not the
    // terminal-state short-circuit (which its own case covers).
    world.world.payable = { ...world.world.payable, state: 'OPEN' };
    // A card attempt carries an instrument, so nothing is reused: the second
    // POST must raise its own charge under its own key.
    await call(world.routes, 'POST', '/charge', body);

    expect(world.charges.all().map((row) => row.idempotencyKey)).toEqual([
      `${REF}:0`,
      `${REF}:1`,
    ]);
    expect(world.charges.all().map((row) => row.reference)).toEqual([REF, `${REF}--1`]);
  });
});

describe('a REDIRECT provider commits the walk the moment it mints a link', () => {
  const hostedChain = [
    { name: 'alpha', adapter: testAdapter('alpha', { tokenization: 'REDIRECT', hosted: true }) },
  ];

  it('answers a SECOND create with the SAME link, and raises no second charge', async () => {
    const world = setupCheckoutWorld({ chain: hostedChain });

    const first = await call(world.routes, 'POST', '/', {});
    const second = await call(world.routes, 'POST', '/', {});

    const url = (first.body.data as Record<string, unknown>).hostedCheckoutUrl;
    expect(typeof url).toBe('string');
    expect((second.body.data as Record<string, unknown>).hostedCheckoutUrl).toBe(url);
    // The whole point: one payable link exists, not two.
    expect(world.charges.all()).toHaveLength(1);
  });

  it('still hands the link back when the buyer re-taps holding no instrument for it', async () => {
    const world = setupCheckoutWorld({ chain: hostedChain, payable: { method: 'CARD' } });
    await call(world.routes, 'POST', '/', {});

    // A card POST DOES carry an instrument — but not one minted for this
    // provider, which takes the card on its own page. Reusing is the honest
    // answer; walking again would mint a second payable charge.
    const retap = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      card: { tokensByProvider: { beta: 'tok_beta' } },
    });
    expect(retap.status).toBe(200);
    expect(world.charges.all()).toHaveLength(1);
  });

  it('advances past a REDIRECT head that refuses BEFORE any link exists', async () => {
    const world = setupCheckoutWorld({
      chain: [
        {
          name: 'alpha',
          adapter: testAdapter('alpha', { tokenization: 'REDIRECT', refuses: true }),
        },
        { name: 'beta', adapter: testAdapter('beta') },
      ],
    });
    const created = await call(world.routes, 'POST', '/', {});
    expect(created.status).toBe(200);
    // The walk reached `beta`, which is only allowed because `alpha` provably
    // created nothing. A minted link would have ended the walk instead.
    expect(world.charges.all()[0]?.provider).toBe('beta');
  });
});

describe('a PIX re-tap reuses the live QR', () => {
  it('hands back the same charge at the same price', async () => {
    const world = setupCheckoutWorld();
    await call(world.routes, 'POST', '/', {});
    await call(world.routes, 'POST', '/', {});
    expect(world.charges.all()).toHaveLength(1);
  });

  it('raises a fresh charge once the payable is repriced, and voids the stale code', async () => {
    const world = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { cancelable: true }) }],
    });
    await call(world.routes, 'POST', '/', {});
    world.world.payable = { ...world.world.payable, amount: BRL(6000) };
    await call(world.routes, 'POST', '/', {});

    const stored = world.charges.all();
    expect(stored).toHaveLength(2);
    // Distinct attempt references, so a reference-deduping provider cannot hand
    // the reprice the first attempt's charge.
    expect(stored.map((row) => row.reference)).toEqual([REF, `${REF}--1`]);
    expect(stored[1]?.snapshot.amount.amountCents).toBe(6000);
    // The superseded code is voided only AFTER the new one is proven good —
    // the buyer must never be left with the old code dead and nothing to pay.
    expect(stored[0]?.snapshot.status).toBe('CANCELED');
  });

  it('leaves the stale code payable, without throwing, on a provider that cannot void', async () => {
    const world = setupCheckoutWorld();
    await call(world.routes, 'POST', '/', {});
    world.world.payable = { ...world.world.payable, amount: BRL(6000) };
    const repriced = await call(world.routes, 'POST', '/', {});

    // Refusing the reprice would block a discount on a payable the buyer can
    // still pay correctly, which is a worse trade than a code that lapses.
    expect(repriced.status).toBe(200);
    expect(world.charges.all()).toHaveLength(2);
  });
});

describe('the wording precedence', () => {
  it('answers an exhausted chain ONCE, naming the method and no provider', async () => {
    const world = setupCheckoutWorld({
      payable: { method: 'CARD' },
      chain: [
        { name: 'alpha', adapter: testAdapter('alpha', { refuses: true }) },
        { name: 'beta', adapter: testAdapter('beta', { refuses: true }) },
      ],
    });
    const { status, body } = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      card: { token: 'tok_ok' },
    });

    expect(status).toBe(502);
    expect(body.code).toBe('PAYMENT_UNAVAILABLE');
    expect(body.error).toBe('copy.chainExhausted.CARD');
    // Neither provider's own words, nor its name, reach the buyer.
    expect(JSON.stringify(body)).not.toMatch(/alpha|beta|fetch failed/);
  });

  it('names the FIELD when nothing was ever sent, rather than reporting an outage', async () => {
    const gated = testAdapter('alpha');
    const world = setupCheckoutWorld({
      payable: { method: 'CARD', customer: { name: 'Ana' } },
      chain: [
        {
          name: 'alpha',
          // The buyer-requirements gate refuses this provider before a byte
          // goes out, so "no provider responded" would be false.
          adapter: { ...gated, customerSchema: [{ key: 'taxId', type: 'CPF', required: true }] },
        },
      ],
    });
    const { status, body } = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      card: { token: 'tok_ok' },
    });

    expect(status).toBe(400);
    expect(body.code).toBe('MISSING_BUYER_FIELD');
    expect(body.field).toBe('cpf');
    expect(world.charges.all()).toEqual([]);
  });
});

describe('charge identity fails closed', () => {
  it('records NOTHING when the store answers with another attempt\'s row', async () => {
    const world = setupCheckoutWorld({ payable: { method: 'CARD' } });
    // Rig the store to hand back a row stored under a different key — exactly
    // what a reference-deduping provider makes the real store do.
    const honest = world.charges.create.bind(world.charges);
    world.charges.create = async (input) => {
      const row = await honest(input);
      return { ...row, idempotencyKey: 'someone-elses-attempt' };
    };

    const { status, body } = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      card: { token: 'tok_ok' },
    });

    expect(status).toBe(409);
    expect(body.code).toBe('CHARGE_MISMATCH');
    // The refusal must not become a decline, and must write no bookkeeping.
    expect(world.correlation.cardOutcomes).toEqual([]);
    expect(world.correlation.pending).toEqual([]);
  });
});

describe('a saved instrument this merchant cannot charge', () => {
  it('is refused with our own copy, never as a decline', async () => {
    const world = setupCheckoutWorld({ payable: { method: 'CARD' }, instruments: {} });
    const { status, body } = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      card: { savedCardToken: 'card_1' },
    });

    expect(status).toBe(409);
    expect(body.code).toBe('INSTRUMENT_NOT_USABLE');
    expect(body.error).toBe('copy.instrumentNotUsableHere');
    expect(world.charges.all()).toEqual([]);
  });
});

describe('a PENDING card charge is not a decline', () => {
  it('attaches it and answers the hosted page instead of failing the payable', async () => {
    const world = setupCheckoutWorld({
      payable: { method: 'CARD' },
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { hosted: true }) }],
    });
    const { status, body } = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      card: { token: 'tok_ok' },
    });

    expect(status).toBe(200);
    expect((body.data as Record<string, unknown>).hostedCheckoutUrl).toContain('/checkout/');
    expect(world.correlation.pending).toHaveLength(1);
    // Nothing authorized yet: no outcome recorded, and no instrument vaulted.
    expect(world.correlation.cardOutcomes).toEqual([]);
  });
});
