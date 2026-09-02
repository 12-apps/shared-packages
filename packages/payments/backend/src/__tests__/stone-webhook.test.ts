import { describe, expect, it } from 'vitest';

import { ProviderRequestError, WebhookVerificationError } from '../core/errors';
import { createPaymentsGateway } from '../core/gateway';
import { defineProviders } from '../core/registry';
import type { MerchantRef, ResolvedCredentials, WebhookDelivery } from '../core/types';
import { createWebhookReactor, type WebhookReactorPorts } from '../core/webhook-reactor';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { PT_BR_STONE_COPY } from '../providers/pt-BR';
import { stoneProvider } from '../providers/stone';

/**
 * Stone webhooks, in the shape Pagar.me actually sends (FUT-674).
 *
 * The adapter's only `charge.paid` fixture used to be `{ id, status }` with no
 * nested order — a payload Pagar.me does not produce. It exercised a fallback
 * branch and passed, while every REAL delivery took the branch above it and
 * degraded to `UNKNOWN`: no charge, nothing applied, and a paid PIX or card
 * that never settled by webhook. Only the buyer's own polling screen saved the
 * order, and only while the buyer kept the tab open.
 *
 * So these run the whole pipeline — verify, inbox, parse, persist, react —
 * rather than the parser alone. The bug was invisible at every layer taken on
 * its own: the parser returned a well-formed event, the pipeline ingested it
 * happily, and the reactor correctly did nothing with an `UNKNOWN`.
 *
 * The fixtures below are the vendor's own published examples, trimmed to the
 * fields this adapter reads. Anything invented here would re-create exactly the
 * defect this suite exists to close.
 */

const TENANT: MerchantRef = { kind: 'TENANT', id: 'tenant-1' };

const WEBHOOK_CREDS: ResolvedCredentials = {
  environment: 'PRODUCTION',
  fields: {
    secretKey: 'sk_live_x',
    publicKey: 'pk_live_x',
    webhookUser: 'hook',
    webhookPassword: 's3cr3t',
  },
};

const AUTHORIZED = `Basic ${Buffer.from('hook:s3cr3t').toString('base64')}`;

/** The order stub Pagar.me nests inside a `charge.*` delivery — no `charges`. */
function orderStub(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'or_omyzASdsdfoGADSFA06',
    code: 'order-1',
    amount: 2538,
    closed: true,
    currency: 'BRL',
    status: 'paid',
    ...over,
  };
}

/**
 * A `charge.*` delivery: `data` IS the charge, with the order nested as a stub.
 * This is the shape that used to be discarded.
 */
function chargeDelivery(
  type: string,
  charge: Record<string, unknown>,
  eventId = 'hook_masdwqYGoIjcEVe5Go',
): WebhookDelivery {
  return {
    provider: 'stone',
    rawBody: JSON.stringify({
      id: eventId,
      account: { id: 'acc_ladsADGdasdgwIEd58A', name: 'Parceiro Teste' },
      type,
      created_at: '2023-01-18T21:22:22.9517556Z',
      data: {
        id: 'ch_bBy6neoSPdsdaewffvxvVd',
        // The CHARGE's own code — an acquirer NSU, and not the host reference.
        code: '11831338033297',
        currency: 'BRL',
        payment_method: 'pix',
        order: orderStub(),
        ...charge,
      },
    }),
    headers: { authorization: AUTHORIZED },
  };
}

/** An `order.*` delivery: `data` IS the order, charges in an array. */
function orderDelivery(
  type: string,
  charges: Array<Record<string, unknown>>,
  eventId = 'hook_RyEKQO789TRpZjv5',
): WebhookDelivery {
  return {
    provider: 'stone',
    rawBody: JSON.stringify({
      id: eventId,
      type,
      data: { id: 'or_ZdnB5BBCmYhk534R', code: 'order-1', amount: 2538, status: 'paid', charges },
    }),
    headers: { authorization: AUTHORIZED },
  };
}

interface Settlement {
  reference: string;
  providerChargeId: string;
  amountCents: number;
}

interface Reversal {
  reference: string;
  providerChargeId: string;
  refundedCents: number;
}

/**
 * A store whose one payable is open, wired to the REAL Stone adapter through
 * the same reactor a host composes. Everything a scenario asserts is read off
 * the recorded calls, never off a mutated closure — the flakiness lint's rule,
 * and the reason each `it` builds its own world.
 */
function stoneWorld() {
  const settled: Settlement[] = [];
  const reversed: Reversal[] = [];
  const charges = createMemoryChargeStore();
  const ports: WebhookReactorPorts = {
    settlePayable: async ({ reference, providerChargeId, amountCents }) => {
      settled.push({ reference, providerChargeId, amountCents });
    },
    payableIsOpen: async (_merchant, reference) => reference === 'order-1',
    parkReversal: async ({ reference, providerChargeId, refundedCents }) => {
      reversed.push({ reference, providerChargeId, refundedCents });
    },
    recordDispute: async () => {},
    // The port an adopting host implements over its own charge table. It is
    // the ONLY reference source a Stone reversal can reach when the order stub
    // names no `code`: a REFUND_UPDATED carries no `charge`, so
    // `ingestWebhookEvents` hands the reactor a null stored charge and the
    // middle fallback is out.
    referenceOf: async (_merchant, _provider, providerChargeId) =>
      (await charges.findByProviderChargeId('stone', providerChargeId))?.reference ?? null,
  };
  const credentials = createMemoryCredentialStore();
  const gateway = createPaymentsGateway({
    providers: defineProviders({ stone: stoneProvider(PT_BR_STONE_COPY) } as const),
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
    onWebhookEvent: createWebhookReactor(ports),
  });
  credentials.set(TENANT, 'stone', WEBHOOK_CREDS);
  return { gateway, charges, settled, reversed };
}

/**
 * The row this adapter's own `createCharge` would have left behind: PENDING,
 * keyed by the charge id the delivery will name. Seeded rather than raised
 * through the gateway so no test here depends on a stubbed `fetch`.
 */
async function seedPendingCharge(charges: ReturnType<typeof createMemoryChargeStore>) {
  await charges.create({
    merchant: TENANT,
    reference: 'order-1',
    snapshot: {
      provider: 'stone',
      providerChargeId: 'ch_bBy6neoSPdsdaewffvxvVd',
      reference: 'order-1',
      status: 'PENDING',
      amount: { amountCents: 2538, currency: 'BRL' },
      method: 'PIX',
    },
  });
}

describe('stone webhooks settle the order', () => {
  it('Scenario: a charge.paid in the real Pagar.me shape settles the order', async () => {
    // Given an order awaiting payment at a Stone store — the charge was raised
    // through this adapter, so the row exists and reads PENDING,
    const world = stoneWorld();
    await seedPendingCharge(world.charges);

    // when a charge.paid arrives whose `data` is the charge with the order nested,
    const events = await world.gateway.handleWebhook(
      TENANT,
      chargeDelivery('charge.paid', { status: 'paid', amount: 2538, paid_amount: 2538 }),
    );

    // then the order is paid exactly once,
    expect(events.map((event) => event.type)).toEqual(['CHARGE_UPDATED']);
    expect(world.settled).toEqual([
      {
        reference: 'order-1',
        providerChargeId: 'ch_bBy6neoSPdsdaewffvxvVd',
        amountCents: 2538,
      },
    ]);
    // and the stored charge row is updated.
    const stored = await world.charges.findByProviderChargeId(
      'stone',
      'ch_bBy6neoSPdsdaewffvxvVd',
    );
    expect(stored?.snapshot).toMatchObject({ status: 'PAID', method: 'PIX' });
  });

  it('settles a charge.paid for which this host holds NO row', async () => {
    // The other half of the same scenario: a store whose row is missing (a
    // second attempt that could not be stored, a charge raised elsewhere) must
    // still settle, by the reference the nested order names.
    const world = stoneWorld();

    await world.gateway.handleWebhook(
      TENANT,
      chargeDelivery('charge.paid', { status: 'paid', amount: 2538, paid_amount: 2538 }),
    );

    expect(world.settled).toEqual([
      { reference: 'order-1', providerChargeId: 'ch_bBy6neoSPdsdaewffvxvVd', amountCents: 2538 },
    ]);
  });

  it('Scenario: order.paid keeps working', async () => {
    const world = stoneWorld();

    // when an order.paid arrives with the full charges array,
    const events = await world.gateway.handleWebhook(
      TENANT,
      orderDelivery('order.paid', [
        { id: 'ch_d22356Jf4WuGr8no', status: 'paid', amount: 2538, payment_method: 'pix' },
      ]),
    );

    // then the order is paid exactly once.
    expect(events.map((event) => event.type)).toEqual(['CHARGE_UPDATED']);
    expect(world.settled).toEqual([
      { reference: 'order-1', providerChargeId: 'ch_d22356Jf4WuGr8no', amountCents: 2538 },
    ]);
  });

  it('Scenario: a short payment reaches the host as what was RECEIVED', async () => {
    const world = stoneWorld();

    // when a charge.underpaid arrives worth less than the order,
    await world.gateway.handleWebhook(
      TENANT,
      chargeDelivery('charge.underpaid', {
        status: 'underpaid',
        amount: 2538,
        paid_amount: 1500,
      }),
    );

    // then the shortfall is what reaches the host — the amount RAISED would
    // clear its coverage guard and settle an underpaid order in full, which is
    // the one outcome worse than today's silence.
    expect(world.settled).toEqual([
      { reference: 'order-1', providerChargeId: 'ch_bBy6neoSPdsdaewffvxvVd', amountCents: 1500 },
    ]);
  });

  it('Scenario: the same notification twice pays once', async () => {
    const world = stoneWorld();
    const delivery = chargeDelivery('charge.paid', {
      status: 'paid',
      amount: 2538,
      paid_amount: 2538,
    });

    // when the same charge.paid arrives twice,
    await world.gateway.handleWebhook(TENANT, delivery);
    await world.gateway.handleWebhook(TENANT, delivery);

    // then the order is paid exactly once.
    expect(world.settled).toHaveLength(1);
  });

  it('Scenario: a wrong Basic auth is refused and nothing is written', async () => {
    const world = stoneWorld();
    const delivery = chargeDelivery('charge.paid', {
      status: 'paid',
      amount: 2538,
      paid_amount: 2538,
    });

    // when a delivery arrives with an invalid Authorization header,
    await expect(
      world.gateway.handleWebhook(TENANT, {
        ...delivery,
        headers: { authorization: 'Basic d3Jvbmc6d3Jvbmc=' },
      }),
    ).rejects.toThrow(WebhookVerificationError);

    // then it is refused and nothing is recorded — verification precedes the
    // inbox, so a rejected delivery leaves no row and settles nothing.
    expect(world.settled).toEqual([]);
    expect(
      await world.charges.findByProviderChargeId('stone', 'ch_bBy6neoSPdsdaewffvxvVd'),
    ).toBeNull();
  });

  it('Scenario: a refund made in the Pagar.me dashboard reaches the ledger', async () => {
    // Given an order already paid at a Stone store,
    const world = stoneWorld();
    await world.gateway.handleWebhook(
      TENANT,
      chargeDelivery('charge.paid', { status: 'paid', amount: 2538, paid_amount: 2538 }),
    );

    // when a charge.refunded arrives — note the charge's own status reads
    // `canceled`, which is why the refund fact is read off the EVENT,
    const events = await world.gateway.handleWebhook(
      TENANT,
      chargeDelivery(
        'charge.refunded',
        {
          status: 'canceled',
          amount: 2538,
          paid_amount: 2538,
          canceled_amount: 2538,
        },
        'hook_3xLXqbnTAufsdfsP',
      ),
    );

    // then the reversal appears against the order.
    expect(events.map((event) => event.type)).toEqual(['REFUND_UPDATED']);
    expect(world.reversed).toEqual([
      {
        reference: 'order-1',
        providerChargeId: 'ch_bBy6neoSPdsdaewffvxvVd',
        refundedCents: 2538,
      },
    ]);
  });

  it('reports a PARTIAL reversal for the portion that went back', async () => {
    const world = stoneWorld();

    // `charge.partial_canceled` is the event Pagar.me actually sends; the name
    // this adapter shipped with (`charge.partial_refunded`) is not in its event
    // list at all, so the partial half had never once fired.
    await world.gateway.handleWebhook(
      TENANT,
      chargeDelivery('charge.partial_canceled', {
        status: 'partial_canceled',
        amount: 2538,
        paid_amount: 2538,
        canceled_amount: 900,
      }),
    );

    expect(world.reversed).toEqual([
      { reference: 'order-1', providerChargeId: 'ch_bBy6neoSPdsdaewffvxvVd', refundedCents: 900 },
    ]);
  });

  it('stands down rather than guessing a partial refund that names no amount', async () => {
    const world = stoneWorld();

    const events = await world.gateway.handleWebhook(
      TENANT,
      chargeDelivery('charge.partial_canceled', { status: 'partial_canceled', amount: 2538 }),
    );

    // The event still arrives — a host that logs unknowns can see it — but no
    // refund is asserted, because `amount` here is the charge as raised and
    // parking the WHOLE order for a partial reversal is money moved on a guess.
    expect(events[0]).toMatchObject({ type: 'REFUND_UPDATED' });
    expect(events[0]?.refund).toBeUndefined();
    expect(world.reversed).toEqual([]);
  });

  it('reads the reference off the nested ORDER, never off the charge', async () => {
    const world = stoneWorld();

    // A POS charge carries an acquirer NSU in its own `code`. Reading that as
    // the reference hands the host an id no order of its is keyed by, and the
    // payable lookup then answers "not mine" for a real payment.
    await world.gateway.handleWebhook(
      TENANT,
      chargeDelivery('charge.paid', { status: 'paid', amount: 2538, paid_amount: 2538 }),
    );

    expect(world.settled.map((call) => call.reference)).toEqual(['order-1']);
  });

  it('REFUSES a shortfall that does not say how much came in', async () => {
    const world = stoneWorld();

    // The amount RAISED is the one number certainly wrong for an `underpaid`
    // charge: reporting it clears the host's coverage guard and settles an
    // order for money that never arrived — strictly worse than the silence
    // this whole change replaces. So the delivery fails loudly and stays
    // retryable instead.
    await expect(
      world.gateway.handleWebhook(
        TENANT,
        chargeDelivery('charge.underpaid', { status: 'underpaid', amount: 2538 }),
      ),
    ).rejects.toThrow(ProviderRequestError);
    expect(world.settled).toEqual([]);
  });

  it('SETTLES an overpayment that does not say how much came in', async () => {
    const world = stoneWorld();

    // The mirror case, and deliberately not symmetric: falling back to the
    // amount raised only UNDER-reports here. At least the payable arrived, so
    // settling is right and only the excess goes unnoticed — where refusing
    // would strand a buyer who paid in full.
    await world.gateway.handleWebhook(
      TENANT,
      chargeDelivery('charge.overpaid', { status: 'overpaid', amount: 2538 }),
    );

    expect(world.settled).toEqual([
      { reference: 'order-1', providerChargeId: 'ch_bBy6neoSPdsdaewffvxvVd', amountCents: 2538 },
    ]);
  });

  it('does not read a paid_amount of zero as a capture of nothing', async () => {
    const world = stoneWorld();

    // `paid_amount: 0` is what an untouched charge carries, and
    // `capturedAmountCents` accepts any number it is handed — so taking it at
    // face value settles the order for nothing while `snapshot-merge` puts the
    // stored amount back into the row: two figures from one delivery, neither
    // of them loud.
    await world.gateway.handleWebhook(
      TENANT,
      chargeDelivery('charge.paid', { status: 'paid', amount: 2538, paid_amount: 0 }),
    );

    expect(world.settled).toEqual([
      { reference: 'order-1', providerChargeId: 'ch_bBy6neoSPdsdaewffvxvVd', amountCents: 2538 },
    ]);
  });

  it('does not read a canceled_amount of zero as a reversal', async () => {
    const world = stoneWorld();

    // Same shape one object along: a refund of zero is one
    // `classifyReversalEvent` accepts, and it would take the payable out of
    // settled for no money at all.
    const events = await world.gateway.handleWebhook(
      TENANT,
      chargeDelivery('charge.partial_canceled', {
        status: 'partial_canceled',
        amount: 2538,
        paid_amount: 2538,
        canceled_amount: 0,
      }),
    );

    // The type assertion is what makes this a pin on `positiveCents` rather
    // than on the event set: without it the case also passes for a build that
    // does not listen for `charge.partial_canceled` at all — which is exactly
    // what the old code did, so it would have proved nothing about the fix.
    expect(events[0]).toMatchObject({ type: 'REFUND_UPDATED' });
    expect(events[0]?.refund).toBeUndefined();
    expect(world.reversed).toEqual([]);
  });

  it('reverses what was CAPTURED when a short-paid charge is refunded whole', async () => {
    const world = stoneWorld();

    // A full reversal returns what the buyer actually paid. On a charge that
    // settled short that is not the amount raised, and reporting the raised
    // one claims more money went back than ever reached the merchant.
    await world.gateway.handleWebhook(
      TENANT,
      chargeDelivery('charge.refunded', { status: 'canceled', amount: 2538, paid_amount: 1500 }),
    );

    expect(world.reversed).toEqual([
      { reference: 'order-1', providerChargeId: 'ch_bBy6neoSPdsdaewffvxvVd', refundedCents: 1500 },
    ]);
  });

  it('never resolves a charge.* delivery to the nested order stub', async () => {
    const world = stoneWorld();
    await seedPendingCharge(world.charges);

    // The stub is the ONLY thing that can carry a `charges` array here, and it
    // never does — so returning it degrades the event to UNKNOWN. Pinned with a
    // stub stripped of its `code`, which removes the reference the other tests
    // read and leaves the stored charge row as the only route to the payable:
    // if the stub were being returned there would be no charge at all, and the
    // event would not be a CHARGE_UPDATED to begin with.
    const events = await world.gateway.handleWebhook(TENANT, {
      provider: 'stone',
      rawBody: JSON.stringify({
        id: 'hook_nocode',
        type: 'charge.paid',
        data: {
          id: 'ch_bBy6neoSPdsdaewffvxvVd',
          code: '11831338033297',
          status: 'paid',
          amount: 2538,
          paid_amount: 2538,
          currency: 'BRL',
          payment_method: 'pix',
          order: { id: 'or_omyzASdsdfoGADSFA06', amount: 2538, status: 'paid' },
        },
      }),
      headers: { authorization: AUTHORIZED },
    });

    expect(events.map((event) => event.type)).toEqual(['CHARGE_UPDATED']);
    // And the charge's own `code` never stood in for the order's: the payable
    // is the stored row's reference, not the acquirer NSU.
    expect(world.settled).toEqual([
      { reference: 'order-1', providerChargeId: 'ch_bBy6neoSPdsdaewffvxvVd', amountCents: 2538 },
    ]);
  });

  it('does not park a payable for a VOID that returned no money', async () => {
    const world = stoneWorld();
    await seedPendingCharge(world.charges);

    // `charge.canceled` is an event stores start receiving because this change
    // names it in the guide. Treating its `canceled_amount` as money returned
    // takes a payable out of settled for a payment that never arrived — and
    // `applyReversal` never asks whether the payable is open, so landing after
    // a retry's `charge.paid` would un-settle a genuinely paid order.
    await world.gateway.handleWebhook(
      TENANT,
      chargeDelivery('charge.canceled', {
        status: 'canceled',
        amount: 2538,
        paid_amount: 0,
        canceled_amount: 2538,
      }),
    );

    expect(world.reversed).toEqual([]);
    expect(world.settled).toEqual([]);
  });

  it('parks a reversal against the PAYABLE, not the attempt that raised it', async () => {
    const world = stoneWorld();

    // A reference carries the attempt (`order-1--1`), and no payable is keyed
    // by one — so the host went on saying PAID for money the buyer had back.
    await world.gateway.handleWebhook(TENANT, {
      provider: 'stone',
      rawBody: JSON.stringify({
        id: 'hook_attempt',
        type: 'charge.refunded',
        data: {
          id: 'ch_bBy6neoSPdsdaewffvxvVd',
          status: 'canceled',
          amount: 2538,
          paid_amount: 2538,
          canceled_amount: 2538,
          currency: 'BRL',
          order: { id: 'or_omyzASdsdfoGADSFA06', code: 'order-1--1' },
        },
      }),
      headers: { authorization: AUTHORIZED },
    });

    expect(world.reversed.map((call) => call.reference)).toEqual(['order-1']);
  });

  it('parks against the payable when only the STORED ROW names the attempt', async () => {
    // The THIRD of `reversalReference`'s sources — this package's own table,
    // via `referenceOf`. A refund whose order stub names no `code` reaches
    // nothing else: the event carries no `charge`, so the reactor is handed a
    // null stored row and the middle fallback is unavailable. The reference it
    // finds is "the payable PLUS the attempt" by construction.
    const world = stoneWorld();
    await world.charges.create({
      merchant: TENANT,
      reference: 'order-1--2',
      snapshot: {
        provider: 'stone',
        providerChargeId: 'ch_bBy6neoSPdsdaewffvxvVd',
        reference: 'order-1--2',
        status: 'PAID',
        amount: { amountCents: 2538, currency: 'BRL' },
        method: 'PIX',
      },
    });

    await world.gateway.handleWebhook(TENANT, {
      provider: 'stone',
      rawBody: JSON.stringify({
        id: 'hook_stored',
        type: 'charge.refunded',
        data: {
          id: 'ch_bBy6neoSPdsdaewffvxvVd',
          status: 'canceled',
          amount: 2538,
          paid_amount: 2538,
          canceled_amount: 2538,
          currency: 'BRL',
          order: { id: 'or_omyzASdsdfoGADSFA06' },
        },
      }),
      headers: { authorization: AUTHORIZED },
    });

    expect(world.reversed.map((call) => call.reference)).toEqual(['order-1']);
  });

  it('leaves an event nobody listens for as UNKNOWN', async () => {
    const world = stoneWorld();

    const events = await world.gateway.handleWebhook(
      TENANT,
      chargeDelivery('charge.created', { status: 'pending', amount: 2538 }),
    );

    expect(events.map((event) => event.type)).toEqual(['UNKNOWN']);
    expect(world.settled).toEqual([]);
  });
});
