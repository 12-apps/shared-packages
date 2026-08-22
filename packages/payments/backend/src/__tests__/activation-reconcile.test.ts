import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  healStrandedActivation,
  reconcileActivationCharges,
  type ActivationReconcileContext,
  type OutstandingActivation,
} from '../activation/reconcile';
import type { PendingVerification } from '../config/types';
import { defineProviders } from '../core/registry';
import type { StoredCharge } from '../core/ports';
import type { MerchantRef } from '../core/types';
import { infinitePayProvider } from '../providers/infinitepay';
import { pagbankProvider } from '../providers/pagbank';
import { activationAdapter, connectedConfig } from './activation-fixtures';
import { PT_BR_INFINITEPAY_COPY, PT_BR_PAGBANK_COPY } from '../providers/pt-BR';

/**
 * The machine that stamps a paid activation nothing else will (FUT-463).
 *
 * A config still holding `pending_verification` while its activation payment
 * is already confirmed is a settlement that half-landed — and the webhook
 * inbox remembers that delivery as settled, so redelivery is dedup-skipped
 * forever. These tests pin down which durable records count as proof (a PAID
 * charge; a PROCESSED InfinitePay delivery naming the reference) and which
 * never do. The REAL adapters answer for themselves: `verifyConfirmsPayment`
 * and the FUT-726 correlation hook are their declarations, not the host's.
 */

const TENANT_ID = '10ac8ef3-5b10-456d-ab97-74ba046180aa';

const db = {
  outstanding: [] as OutstandingActivation[],
  charges: new Map<string, StoredCharge>(),
  deliveries: [] as Array<{ merchantId: string; provider: string; payload: string }>,
  proven: new Set<string>(),
  applied: [] as Array<{ merchant: MerchantRef; provider: string; passed: boolean }>,
  // `null` marks a cleared row (never removed from the map): the flakiness
  // gate reads `.delete()` in a test as a database operation.
  pending: new Map<string, PendingVerification | null>(),
};

/** The card-flow adapter under cure (FUT-679): probe + refund are scripted. */
const cure = {
  findChargeByReference: vi.fn(),
  refund: vi.fn(),
};

/**
 * A SECOND provider whose deliveries count as proof — the case FUT-726 exists
 * for. Its payload spells the correlation key `external_reference`, nothing
 * like InfinitePay's `order_nsu`, so any correlation done outside the adapter
 * would read this body and confidently find nothing.
 */
const linkPayProvider = (): ReturnType<typeof activationAdapter> =>
  activationAdapter(
    'linkpay',
    {},
    {
      verifyConfirmsPayment: true,
      referenceOfDelivery: (payload) => {
        const body = JSON.parse(payload) as { external_reference?: unknown };
        return typeof body.external_reference === 'string' ? body.external_reference : null;
      },
    },
  );

// Real adapters, so the gating reads their own declarations.
const providers = defineProviders({
  pagbank: pagbankProvider(PT_BR_PAGBANK_COPY),
  infinitepay: infinitePayProvider(PT_BR_INFINITEPAY_COPY),
  linkpay: linkPayProvider(),
  cardpay: activationAdapter('cardpay', {
    findChargeByReference: cure.findChargeByReference as never,
    refund: cure.refund as never,
  }),
});

const pendingKey = (merchant: MerchantRef, provider: string): string =>
  `${merchant.id}:${provider}`;

function context(): ActivationReconcileContext {
  return {
    providers,
    settings: {
      applyChargeVerification: async (merchant, provider, passed) => {
        // Driven by the id rather than a flag, so no test has to reach in
        // and mutate shared state to describe a failure.
        if (merchant.id === 'broken-tenant') throw new Error('database blip');
        db.applied.push({ merchant, provider, passed });
        // Mirror `applyProof`: settling clears the outstanding row.
        db.pending.set(pendingKey(merchant, provider), null);
        return {} as never;
      },
      getPendingVerification: async (merchant, provider) =>
        db.pending.get(pendingKey(merchant, provider)) ?? null,
      setPendingVerification: async (merchant, provider, pending) => {
        db.pending.set(pendingKey(merchant, provider), pending);
      },
    },
    config: {
      get: async (merchant, provider) =>
        connectedConfig({
          provider,
          ...(db.proven.has(`${merchant.id}:${provider}`)
            ? { chargeVerifiedAt: new Date('2026-07-31T00:00:00Z') }
            : {}),
        }),
    },
    charges: {
      findByProviderChargeId: async (provider, providerChargeId) =>
        db.charges.get(`${provider}:${providerChargeId}`) ?? null,
    },
    proofs: {
      listOutstanding: async () => db.outstanding,
      findProcessedDeliveryPayload: async (merchant, provider, reference) =>
        db.deliveries.find(
          (row) =>
            row.merchantId === merchant.id &&
            row.provider === provider &&
            row.payload.includes(reference),
        )?.payload ?? null,
    },
  };
}

function referenceOf(provider = 'infinitepay', merchantId = TENANT_ID): string {
  return `verify-${provider}-${merchantId}`;
}

function stranded(provider = 'infinitepay', merchantId = TENANT_ID): OutstandingActivation {
  return {
    merchant: { kind: 'TENANT', id: merchantId },
    provider,
    reference: referenceOf(provider, merchantId),
  };
}

function paidCharge(provider = 'infinitepay', merchantId = TENANT_ID, status = 'PAID'): void {
  db.charges.set(`${provider}:${referenceOf(provider, merchantId)}`, {
    merchant: { kind: 'TENANT', id: merchantId },
    snapshot: { status },
  } as StoredCharge);
}

/** A PROCESSED delivery whose payload names the activation reference. */
function processedDelivery(provider = 'infinitepay', merchantId = TENANT_ID): void {
  db.deliveries.push({
    merchantId,
    provider,
    payload: JSON.stringify({
      order_nsu: referenceOf(provider, merchantId),
      transaction_nsu: 'f736add8-0000-0000-0000-000000000000',
      amount: 101,
    }),
  });
}

/** A card attempt's reference — always suffixed: the flow mints per attempt. */
function cardReference(merchantId = TENANT_ID): string {
  return `verify-cardpay-${merchantId}--k9x`;
}

function strandedCard(merchantId = TENANT_ID): OutstandingActivation {
  return {
    merchant: { kind: 'TENANT', id: merchantId },
    provider: 'cardpay',
    reference: cardReference(merchantId),
  };
}

/** The row still standing for this config, as the fake store reports it. */
function pendingRowOf(merchantId = TENANT_ID, provider = 'cardpay'): PendingVerification | null {
  return db.pending.get(`${merchantId}:${provider}`) ?? null;
}

/** The card flow's write-ahead row, still standing — its answer was lost. */
function pendingCardRow(merchantId = TENANT_ID): void {
  db.pending.set(`${merchantId}:cardpay`, {
    reference: cardReference(merchantId),
    checkoutUrl: '',
    startedAt: '2026-08-01T00:00:00.000Z',
    phase: 'CARD',
  });
}

beforeEach(() => {
  // Emptied in place: the context closures captured these containers, so
  // reassigning would leave them reading the prior test's data.
  db.outstanding.length = 0;
  db.charges.clear();
  db.deliveries.length = 0;
  db.proven.clear();
  db.applied.length = 0;
  db.pending.clear();
  vi.clearAllMocks();
});

describe('reconcileActivationCharges', () => {
  it('stamps a config whose activation charge is recorded PAID', async () => {
    db.outstanding.push(stranded());
    paidCharge();

    const report = await reconcileActivationCharges(context());

    expect(report).toEqual({ checked: 1, stamped: 1 });
    expect(db.applied[0]).toEqual({
      merchant: { kind: 'TENANT', id: TENANT_ID },
      provider: 'infinitepay',
      passed: true,
    });
  });

  /**
   * The proof an activation usually leaves: the charge is raised through the
   * adapter directly, so there is no charge row for the delivery to update —
   * only the PROCESSED inbox row, which InfinitePay's own `payment_check`
   * confirmed before it settled.
   */
  it('stamps from a PROCESSED InfinitePay delivery when no charge row exists', async () => {
    db.outstanding.push(stranded());
    processedDelivery();

    const report = await reconcileActivationCharges(context());

    expect(report).toEqual({ checked: 1, stamped: 1 });
  });

  /** A signature-verified provider's inbox row proves the sender, not payment. */
  it("does not take another provider's inbox row as proof of payment", async () => {
    db.outstanding.push(stranded('pagbank'));
    processedDelivery('pagbank');

    const report = await reconcileActivationCharges(context());

    expect(report).toEqual({ checked: 1, stamped: 0 });
  });

  /**
   * FUT-726 — a SECOND proof-carrying provider settles through ITS OWN key.
   *
   * The delivery below carries no `order_nsu` at all. Correlation that lived
   * out here would have one vendor's field name compiled into it and would
   * leave this store stranded forever; asking the adapter, it settles.
   */
  it("correlates another proof-carrying provider by that adapter's own key", async () => {
    db.outstanding.push(stranded('linkpay'));
    db.deliveries.push({
      merchantId: TENANT_ID,
      provider: 'linkpay',
      payload: JSON.stringify({ external_reference: referenceOf('linkpay'), status: 'paid' }),
    });

    const report = await reconcileActivationCharges(context());

    expect(report).toEqual({ checked: 1, stamped: 1 });
  });

  /** FUT-726: the ADAPTER reads its correlation key out of the payload. */
  it("requires the reference to be the delivery's own correlation key", async () => {
    db.outstanding.push(stranded());
    db.deliveries.push({
      merchantId: TENANT_ID,
      provider: 'infinitepay',
      // The reference appears in the body, but as somebody else's field.
      payload: JSON.stringify({ order_nsu: 'order-123', note: referenceOf() }),
    });

    const report = await reconcileActivationCharges(context());

    expect(report.stamped).toBe(0);
  });

  it('leaves a config alone while its charge is still unpaid', async () => {
    db.outstanding.push(stranded());
    paidCharge('infinitepay', TENANT_ID, 'PENDING');

    const report = await reconcileActivationCharges(context());

    expect(report).toEqual({ checked: 1, stamped: 0 });
    expect(db.applied).toHaveLength(0);
  });

  /**
   * The pending row's reference must be the one this config's own identity
   * derives — a row carrying someone else's reference proves nothing here.
   */
  it("skips a pending row whose reference is not this config's own", async () => {
    db.outstanding.push({
      merchant: { kind: 'TENANT', id: TENANT_ID },
      provider: 'infinitepay',
      reference: 'verify-infinitepay-another-store',
    });
    paidCharge();

    const report = await reconcileActivationCharges(context());

    expect(report.checked).toBe(0);
    expect(db.applied).toHaveLength(0);
  });

  /** Charge identity never crosses merchants — same rule as the webhook upsert. */
  it('refuses a charge that belongs to a different merchant', async () => {
    db.outstanding.push(stranded());
    db.charges.set(`infinitepay:${referenceOf()}`, {
      merchant: { kind: 'TENANT', id: 'someone-else' },
      snapshot: { status: 'PAID' },
    } as StoredCharge);

    const report = await reconcileActivationCharges(context());

    expect(report.stamped).toBe(0);
  });

  it('one failing row does not stop the rest from stamping', async () => {
    db.outstanding.push(stranded('infinitepay', 'broken-tenant'), stranded());
    paidCharge('infinitepay', 'broken-tenant');
    paidCharge();

    const report = await reconcileActivationCharges(context());

    expect(report).toEqual({ checked: 2, stamped: 1 });
    expect(db.applied).toHaveLength(1);
  });
});

describe('healStrandedActivation', () => {
  it('stamps immediately when the settings screen finds a settled charge', async () => {
    db.outstanding.push(stranded());
    processedDelivery();

    const healed = await healStrandedActivation(
      context(),
      { kind: 'TENANT', id: TENANT_ID },
      'infinitepay',
      referenceOf(),
    );

    expect(healed).toBe(true);
    expect(db.applied).toHaveLength(1);
  });

  it('answers false when nothing durable proves the payment', async () => {
    db.outstanding.push(stranded());

    expect(
      await healStrandedActivation(
        context(),
        { kind: 'TENANT', id: TENANT_ID },
        'infinitepay',
        referenceOf(),
      ),
    ).toBe(false);
    expect(db.applied).toHaveLength(0);
  });

  /** Healing must never switch a paused-but-proven provider back on. */
  it('leaves an already-proven config alone', async () => {
    db.proven.add(`${TENANT_ID}:infinitepay`);
    processedDelivery();

    expect(
      await healStrandedActivation(
        context(),
        { kind: 'TENANT', id: TENANT_ID },
        'infinitepay',
        referenceOf(),
      ),
    ).toBe(false);
    expect(db.applied).toHaveLength(0);
  });

  it("refuses a pending reference that is not this config's own", async () => {
    processedDelivery();

    const healed = await healStrandedActivation(
      context(),
      { kind: 'TENANT', id: TENANT_ID },
      'infinitepay',
      'verify-infinitepay-another-store',
    );

    expect(healed).toBe(false);
  });
});

/**
 * FUT-679 — the CARD cure. A card verification charge whose `create` answer
 * was lost leaves NEITHER durable proof, ever: no stored charge (it is raised
 * through the adapter directly) and no proof-carrying inbox row (a
 * signature-verifying provider's webhook proves the sender). Its reference is
 * the key the adapter indexed the order under, so for rows the card flow
 * marked `phase: 'CARD'` the sweep asks the provider — and then refunds the
 * cent and applies the activation, or releases a row holding no live charge.
 */
describe('Cenário: cobrança encalhada é curada pela varredura', () => {
  it('Dado uma cobrança de verificação criada cuja resposta se perdeu, Quando a reconciliação roda, Então a ativação é aplicada ou o centavo estornado — nunca esquecido', async () => {
    db.outstanding.push(strandedCard());
    pendingCardRow();
    cure.findChargeByReference.mockResolvedValue({ status: 'PAID', providerChargeId: 'CH_LOST' });
    cure.refund.mockResolvedValue({});

    const report = await reconcileActivationCharges(context());

    expect(report).toEqual({ checked: 1, stamped: 1 });
    // BOTH halves: the stranded cent went back AND the proof it carries landed.
    expect(cure.refund).toHaveBeenCalledWith(
      expect.objectContaining({ providerChargeId: 'CH_LOST' }),
      expect.anything(),
    );
    expect(db.applied[0]).toMatchObject({ provider: 'cardpay', passed: true });
    expect(pendingRowOf()).toBeNull();
  });

  it('still applies the activation when the refund fails — the cent is reported, never blocking', async () => {
    db.outstanding.push(strandedCard());
    pendingCardRow();
    cure.findChargeByReference.mockResolvedValue({ status: 'PAID', providerChargeId: 'CH_LOST' });
    cure.refund.mockRejectedValue(new Error('refund unavailable'));

    const report = await reconcileActivationCharges(context());

    expect(report.stamped).toBe(1);
    expect(db.applied).toHaveLength(1);
  });

  it('does not refund again a charge the provider already shows refunded', async () => {
    db.outstanding.push(strandedCard());
    pendingCardRow();
    cure.findChargeByReference.mockResolvedValue({
      status: 'REFUNDED',
      providerChargeId: 'CH_LOST',
    });

    const report = await reconcileActivationCharges(context());

    // REFUNDED means paid first — the connection demonstrably charges.
    expect(report.stamped).toBe(1);
    expect(cure.refund).not.toHaveBeenCalled();
  });

  it('releases the row when the provider says no charge exists behind the reference', async () => {
    db.outstanding.push(strandedCard());
    pendingCardRow();
    cure.findChargeByReference.mockResolvedValue(null);

    const report = await reconcileActivationCharges(context());

    expect(report).toEqual({ checked: 1, stamped: 0 });
    expect(db.applied).toHaveLength(0);
    // Released, so the screen stops resuming a dead attempt and retries start clean.
    expect(pendingRowOf()).toBeNull();
  });

  it('releases a lost attempt whose decline arrived late, without stamping anything', async () => {
    db.outstanding.push(strandedCard());
    pendingCardRow();
    cure.findChargeByReference.mockResolvedValue({
      status: 'DECLINED',
      providerChargeId: 'CH_LOST',
      declineReason: 'CARD_DECLINED',
    });

    const report = await reconcileActivationCharges(context());

    expect(report.stamped).toBe(0);
    expect(db.applied).toHaveLength(0);
    expect(pendingRowOf()).toBeNull();
  });

  it('keeps the row when the provider cannot answer — an unanswerable question settles nothing', async () => {
    db.outstanding.push(strandedCard());
    pendingCardRow();
    cure.findChargeByReference.mockRejectedValue(new Error('socket hang up'));

    const report = await reconcileActivationCharges(context());

    expect(report.stamped).toBe(0);
    expect(pendingRowOf()).not.toBeNull();
  });

  it('never polls the provider for a row the card flow did not mark', async () => {
    // A redirect-shaped row on the SAME provider: no `phase`, a checkout URL.
    db.outstanding.push(strandedCard());
    db.pending.set(`${TENANT_ID}:cardpay`, {
      reference: cardReference(),
      checkoutUrl: 'https://pay.example/x',
      startedAt: '2026-08-01T00:00:00.000Z',
    });

    const report = await reconcileActivationCharges(context());

    // The redirect lifecycle is untouched: no poll, no release, no stamp.
    expect(cure.findChargeByReference).not.toHaveBeenCalled();
    expect(report.stamped).toBe(0);
    expect(pendingRowOf()).not.toBeNull();
  });

  it('the settings-screen heal cures a stranded card attempt the moment the owner looks', async () => {
    pendingCardRow();
    cure.findChargeByReference.mockResolvedValue({ status: 'PAID', providerChargeId: 'CH_LOST' });
    cure.refund.mockResolvedValue({});

    const healed = await healStrandedActivation(
      context(),
      { kind: 'TENANT', id: TENANT_ID },
      'cardpay',
      cardReference(),
    );

    expect(healed).toBe(true);
    expect(cure.refund).toHaveBeenCalled();
    expect(db.applied).toHaveLength(1);
  });
});
