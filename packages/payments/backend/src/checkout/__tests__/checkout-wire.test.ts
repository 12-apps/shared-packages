import { describe, expect, it } from 'vitest';

import type { PaymentProviderAdapter } from '../../core/provider';
import type { ChargeInput, Money } from '../../core/types';

import { BRL, call, setupCheckoutWorld, testAdapter } from './harness';

const REF = 'inv_2024_0043';
const STATUS = `/status?orderId=${REF}`;

/**
 * THE REQUEST, AND WHAT THE ROUTES ARE ALLOWED TO DECIDE FROM IT (FUT-740).
 *
 * Every case here failed on a mount whose `PayablePort.load(caller, ref)` saw no
 * request, no intent and no body — so the intended METHOD, the card INSTRUMENT
 * and the buyer's CPF all arrived at the door and had no way through it. The
 * existing suites never caught any of them because they construct the library's
 * own draft shape by hand; these drive the wire.
 */

/** An adapter that keeps every `ChargeInput` the gateway handed it. */
function recordingAdapter(
  name: string,
  seen: ChargeInput[],
  base: PaymentProviderAdapter = testAdapter(name),
): PaymentProviderAdapter {
  return {
    ...base,
    async createCharge(input, credentials) {
      seen.push(input);
      return base.createCharge(input, credentials);
    },
  };
}

/**
 * An adapter that normalizes a REUSABLE vault token onto its card snapshots —
 * what a provider that agreed to store the card returns, and the only thing the
 * mount will ever hand the host's vault.
 */
function vaultingAdapter(base: PaymentProviderAdapter): PaymentProviderAdapter {
  return {
    ...base,
    async createCharge(input, credentials) {
      const snapshot = await base.createCharge(input, credentials);
      if (!snapshot.card) return snapshot;
      return {
        ...snapshot,
        card: { ...snapshot.card, vaultToken: `vault_${input.card?.token ?? 'unknown'}` },
      };
    },
  };
}

describe('a card charge cannot settle a payable the buyer is paying another way', () => {
  it('refuses the card charge and leaves the live QR alone', async () => {
    // A PIX payable, with a code the buyer is holding.
    const world = setupCheckoutWorld();
    await call(world.routes, 'POST', '/', {});
    const [qr] = world.charges.all();
    expect(qr?.snapshot.pix?.qrText).toBeTruthy();

    const charged = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      card: { token: 'tok_ok' },
    });

    // The replaced host route answered a non-card order with a 404, and so does
    // this: "absent", "not yours" and "not card-payable" stay one answer.
    expect(charged.status).toBe(404);
    expect(charged.body.code).toBe('PAYABLE_NOT_FOUND');
    // The whole exposure: without this the card settled the payable while the
    // QR stayed PENDING and scannable — two payable codes for one payable, and
    // one the superseded-code void cannot reach (it only looks at PIX charges
    // priced at some OTHER amount, and this one is priced at the same).
    expect(world.correlation.cardOutcomes).toEqual([]);
    expect(world.world.payable.state).toBe('OPEN');
    expect(world.charges.all()).toHaveLength(1);
    expect(world.charges.all()[0]?.snapshot.status).toBe('PENDING');
  });

  it('still charges a payable whose own method IS card', async () => {
    const world = setupCheckoutWorld({ payable: { method: 'CARD' } });
    const charged = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      card: { token: 'tok_ok' },
    });
    expect(charged.status).toBe(200);
    expect(world.correlation.cardOutcomes).toHaveLength(1);
  });
});

/**
 * THE PUBLISHED WIRE SHAPE.
 *
 * `@12-apps/payments-frontend@1.4.x` posts a FLAT charge body and is already in
 * browsers. A mount that reads only a nested `card` block got `card: undefined`
 * from every one of them — the provider was handed no instrument at all, and
 * the buyer was told their card had been declined.
 */
describe('the charge body the shipped client actually sends', () => {
  it('reads the instrument, the opt-in and the metadata off the FLAT body', async () => {
    const seen: ChargeInput[] = [];
    const world = setupCheckoutWorld({
      payable: { method: 'CARD' },
      chain: [
        { name: 'alpha', adapter: vaultingAdapter(recordingAdapter('alpha', seen)) },
      ],
    });

    const charged = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      token: 'tok_ok',
      saveCard: true,
      cardMeta: { brand: 'visa', last4: '4242' },
    });

    expect(charged.status).toBe(200);
    expect((charged.body.data as Record<string, unknown>).status).toBe('SETTLED');
    expect(seen[0]?.card).toEqual({ token: 'tok_ok' });
    // `saveCard` / `cardMeta` are the same opt-in the nested shape calls
    // `saveInstrument` / `instrumentDisplay`, so the card is actually vaulted.
    expect(world.vault.saved).toEqual([
      { provider: 'alpha', token: 'vault_tok_ok', display: { brand: 'visa', last4: '4242' } },
    ]);
  });

  it('carries tokensByProvider through to the walk (FUT-563)', async () => {
    const seen: ChargeInput[] = [];
    const world = setupCheckoutWorld({
      payable: { method: 'CARD' },
      chain: [{ name: 'alpha', adapter: recordingAdapter('alpha', seen) }],
    });

    await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      token: 'tok_head',
      tokensByProvider: { alpha: 'tok_alpha', beta: 'tok_beta' },
      saveCard: false,
    });

    // The map reaches the walk, which hands each provider ITS OWN instrument —
    // never the bare `tok_head`, which belongs to whoever minted it and would
    // get every other entry refused as holding someone else's instrument.
    expect(seen[0]?.card?.tokensByProvider).toEqual({
      alpha: 'tok_alpha',
      beta: 'tok_beta',
    });
    expect(seen[0]?.card?.token).toBe('tok_alpha');
  });

  it('still accepts the canonical nested body, which wins where both are sent', async () => {
    const seen: ChargeInput[] = [];
    const world = setupCheckoutWorld({
      payable: { method: 'CARD' },
      chain: [{ name: 'alpha', adapter: recordingAdapter('alpha', seen) }],
    });

    await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      card: { token: 'tok_nested' },
      token: 'tok_flat',
    });

    expect(seen[0]?.card).toEqual({ token: 'tok_nested' });
  });
});

/**
 * `token` NAMES TWO DIFFERENT THINGS on the flat wire — "a fresh token, or a
 * saved card's id for reuse", in the shipped client's own words. Only the vault
 * can tell them apart, which is exactly what the replaced host route asked it.
 */
describe('the flat body\'s one instrument field', () => {
  it('charges a handle the vault holds from the vault', async () => {
    const seen: ChargeInput[] = [];
    const world = setupCheckoutWorld({
      payable: { method: 'CARD' },
      chain: [{ name: 'alpha', adapter: recordingAdapter('alpha', seen) }],
      instruments: { card_1: 'vault_tok_1' },
    });

    const charged = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      token: 'card_1',
      saveCard: false,
    });

    expect(charged.status).toBe(200);
    expect(seen[0]?.card).toEqual({ savedCardToken: 'vault_tok_1' });
    // Already vaulted — re-saving it would duplicate the buyer's own card.
    expect(world.vault.saved).toEqual([]);
  });

  it('charges a handle the vault never heard of as a fresh token', async () => {
    const seen: ChargeInput[] = [];
    const world = setupCheckoutWorld({
      payable: { method: 'CARD' },
      chain: [{ name: 'alpha', adapter: recordingAdapter('alpha', seen) }],
      instruments: { card_1: 'vault_tok_1' },
    });

    const charged = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      token: 'tok_fresh_from_the_browser',
      saveCard: false,
    });

    expect(charged.status).toBe(200);
    expect(seen[0]?.card).toEqual({ token: 'tok_fresh_from_the_browser' });
  });

  it('still refuses a handle the buyer OWNS that this merchant cannot charge', async () => {
    const world = setupCheckoutWorld({
      payable: { method: 'CARD' },
      // Present, with no token for this scope: the buyer's own card, saved at a
      // provider this merchant does not collect through (FUT-697).
      instruments: { card_1: null },
    });

    const charged = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      token: 'card_1',
      saveCard: false,
    });

    expect(charged.status).toBe(409);
    expect(charged.body.code).toBe('INSTRUMENT_NOT_USABLE');
    // A scope mismatch must never reach a provider and come back a decline.
    expect(world.charges.all()).toEqual([]);
  });
});

/**
 * THE BUYER'S CPF (FUT-595 / FUT-740).
 *
 * The client asks for it on the card form and sends it with the charge; the
 * host's payable row has no column to keep it in. Sourced from the payable
 * alone, the required-field gate then refuses every card checkout at a PagBank
 * store, asking the buyer for the document they typed two screens earlier.
 */
describe('a buyer field collected at the payment step', () => {
  const requiring = (): PaymentProviderAdapter => ({
    ...testAdapter('alpha'),
    customerSchema: [{ key: 'taxId', type: 'CPF', required: true }],
  });
  const anonymous = { name: 'Ana Buyer', email: 'ana@example.com' };

  it('reaches the provider from the request when the payable cannot carry it', async () => {
    const seen: ChargeInput[] = [];
    const world = setupCheckoutWorld({
      payable: { method: 'CARD', customer: anonymous },
      chain: [{ name: 'alpha', adapter: recordingAdapter('alpha', seen, requiring()) }],
    });

    const charged = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      token: 'tok_ok',
      taxId: '12345678909',
    });

    expect(charged.status).toBe(200);
    expect((charged.body.data as Record<string, unknown>).status).toBe('SETTLED');
    expect(seen[0]?.customer).toEqual({ ...anonymous, taxId: '12345678909' });
  });

  it('still refuses, naming the field, when nobody sent one', async () => {
    const world = setupCheckoutWorld({
      payable: { method: 'CARD', customer: anonymous },
      chain: [{ name: 'alpha', adapter: requiring() }],
    });

    const charged = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      token: 'tok_ok',
    });

    expect(charged.status).toBe(400);
    expect(charged.body.code).toBe('MISSING_BUYER_FIELD');
    expect(charged.body.field).toBe('cpf');
    expect(world.charges.all()).toEqual([]);
  });

  it('never blanks out what the payable already knew', async () => {
    const seen: ChargeInput[] = [];
    const world = setupCheckoutWorld({
      payable: { method: 'CARD', customer: { ...anonymous, taxId: '12345678909' } },
      chain: [{ name: 'alpha', adapter: recordingAdapter('alpha', seen, requiring()) }],
    });

    // A returning buyer never saw the Dados step, so the client has no CPF to
    // send. An absent field must leave the payable's own answer standing.
    const charged = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      token: 'tok_ok',
    });

    expect(charged.status).toBe(200);
    expect(seen[0]?.customer?.taxId).toBe('12345678909');
  });
});

/**
 * THE POLL reads the payable's LATEST charge, not its pending one.
 *
 * `listPayable` is PENDING-only by contract — right for "may this re-tap reuse a
 * code", wrong for "what became of the charge we raised". A poll built on it
 * loses its own charge the moment the charge stops being pending, including
 * when the poll's own refresh is what moved it.
 */
describe('the settlement poll', () => {
  /** PENDING → AUTHORIZED on the first read, PAID on every one after. */
  function settlingLate(name: string, captured: Money): PaymentProviderAdapter {
    const base = testAdapter(name);
    const reads = { count: 0 };
    return {
      ...base,
      async getCharge(providerChargeId, credentials, hints) {
        reads.count += 1;
        const snapshot = await base.getCharge(providerChargeId, credentials, hints);
        if (reads.count === 1) return { ...snapshot, status: 'AUTHORIZED' };
        return { ...snapshot, status: 'PAID', amount: captured };
      },
    };
  }

  it('keeps hold of a charge that has left PENDING, and settles it', async () => {
    const world = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: settlingLate('alpha', BRL(7500)) }],
    });
    await call(world.routes, 'POST', '/', {});

    // Poll one: the provider says AUTHORIZED, which is not a settlement — and
    // `refreshCharge` persists what it read, so the stored row is no longer
    // PENDING from here on.
    expect((await call(world.routes, 'GET', STATUS)).body.data).toBe('OPEN');
    expect(world.charges.all()[0]?.snapshot.status).toBe('AUTHORIZED');

    // Poll two: the provider says PAID. Read through the PENDING-only query the
    // poll no longer has a charge at all, and answers OPEN for ever on a
    // payable the provider has already reported paid.
    const settled = await call(world.routes, 'GET', STATUS);
    expect(settled.body.data).toBe('SETTLED');
    expect(world.correlation.settlements).toEqual([{ ref: REF, capturedAmount: BRL(7500) }]);
  });
});

/**
 * THE PORT BOUNDARY ITSELF — the one thing all four defects came out of. A
 * host's `load` IS its authorization scope, so what it can see is contract.
 */
describe('what the host\'s load is handed', () => {
  it('hands the charge row its intent, its method and the normalized draft', async () => {
    const world = setupCheckoutWorld({ payable: { method: 'CARD' } });
    await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      token: 'tok_ok',
      saveCard: true,
      taxId: '12345678909',
    });

    const [context] = world.loads;
    expect(context?.intent.kind).toBe('chargeInstrument');
    expect(context?.method).toBe('CARD');
    expect(context?.draft).toEqual({
      card: { token: 'tok_ok' },
      ambiguousInstrument: true,
      saveInstrument: true,
      customer: { taxId: '12345678909' },
    });
    expect(context?.request.method).toBe('POST');
  });

  it('hands a pure read no method and no draft', async () => {
    const world = setupCheckoutWorld();
    await call(world.routes, 'GET', STATUS);

    const [context] = world.loads;
    expect(context?.intent.kind).toBe('getStatus');
    expect(context?.method).toBeNull();
    expect(context?.draft).toBeNull();
  });
});
