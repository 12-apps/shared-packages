import { describe, expect, it, vi } from 'vitest';

import { createWebhookReactor, type WebhookReactorPorts } from '../core/webhook-reactor';
import type { MerchantRef, NormalizedWebhookEvent, StoredCharge } from '../index';

/**
 * The webhook FAN-IN: the order the reactions run in, and which of them may
 * consume a delivery.
 *
 * Every case here is a payment that went wrong before the rule was written
 * down, which is exactly why no host should be deriving the order for itself.
 */

const TENANT: MerchantRef = { kind: 'TENANT', id: 'store_1' };
const PLATFORM: MerchantRef = { kind: 'PLATFORM', id: 'platform' };

function paidEvent(over: Record<string, unknown> = {}): NormalizedWebhookEvent {
  // `charge` is merged rather than replaced — spreading `over` last would drop
  // the PAID status a caller only meant to re-reference.
  const { charge: chargeOver, ...rest } = over;
  return {
    eventId: 'evt_1',
    provider: 'pagbank',
    type: 'CHARGE_UPDATED',
    ...rest,
    charge: {
      status: 'PAID',
      provider: 'pagbank',
      providerChargeId: 'ch_1',
      reference: 'ord_1',
      method: 'PIX',
      amount: { amountCents: 1000, currency: 'BRL' },
      ...(chargeOver as Record<string, unknown>),
    },
  } as unknown as NormalizedWebhookEvent;
}

function storedCharge(over: Partial<StoredCharge> = {}): StoredCharge {
  return {
    reference: 'ord_1',
    merchant: TENANT,
    snapshot: { provider: 'pagbank', providerChargeId: 'ch_1' },
    ...over,
  } as unknown as StoredCharge;
}

function ports(over: Partial<WebhookReactorPorts> = {}) {
  const spies = {
    settlePayable: vi.fn().mockResolvedValue(undefined),
    payableIsOpen: vi.fn().mockResolvedValue(true),
    settlePlatformPayment: vi.fn().mockResolvedValue(undefined),
    parkReversal: vi.fn().mockResolvedValue(undefined),
    recordDispute: vi.fn().mockResolvedValue(undefined),
    settleActivation: vi.fn().mockResolvedValue(false),
    ...over,
  };
  return spies as WebhookReactorPorts & typeof spies;
}

describe('rule 4 — no stored charge is not "no payment"', () => {
  /**
   * The failure this rule is named after: the buyer paid, the provider said so,
   * and the reaction was dropped because OUR row was absent.
   */
  it('settles by reference when nothing was stored', async () => {
    const p = ports();
    await createWebhookReactor(p)(paidEvent(), null, TENANT);
    expect(p.settlePayable).toHaveBeenCalledWith({
      reference: 'ord_1',
      providerChargeId: 'ch_1',
      method: 'PIX',
      amountCents: 1000,
    });
  });

  it('settles nothing when the payable is already closed', async () => {
    const p = ports({ payableIsOpen: vi.fn().mockResolvedValue(false) });
    await createWebhookReactor(p)(paidEvent(), null, TENANT);
    expect(p.settlePayable).not.toHaveBeenCalled();
  });

  /** A reference naming another store's payable resolves to nothing. */
  it('never settles a PLATFORM delivery through the payable path', async () => {
    const p = ports();
    await createWebhookReactor(p)(paidEvent(), null, PLATFORM);
    expect(p.settlePayable).not.toHaveBeenCalled();
  });
});

describe('rule 5 — branch on the merchant, never on the reference shape', () => {
  it('sends a PLATFORM charge to the subscription port', async () => {
    const p = ports();
    const charge = storedCharge({ merchant: PLATFORM, reference: 'subpay_9' } as Partial<StoredCharge>);
    await createWebhookReactor(p)(paidEvent(), charge, PLATFORM);
    expect(p.settlePlatformPayment).toHaveBeenCalledWith({
      reference: 'subpay_9',
      amountCents: 1000,
      providerChargeId: 'ch_1',
    });
    expect(p.settlePayable).not.toHaveBeenCalled();
  });

  /**
   * The stored reference names the payable PLUS the attempt. Passing it whole
   * hands the host an id no payable has, so a payment made on any attempt after
   * the first settles nothing.
   */
  it('strips the attempt suffix off a stored reference', async () => {
    const p = ports();
    await createWebhookReactor(p)(paidEvent(), storedCharge({ reference: 'ord_1--2' }), TENANT);
    expect(p.settlePayable).toHaveBeenCalledWith(expect.objectContaining({ reference: 'ord_1' }));
  });

  it('routes a PLATFORM charge nowhere when the host has no platform direction', async () => {
    const p = ports({ settlePlatformPayment: undefined });
    const charge = storedCharge({ merchant: PLATFORM } as Partial<StoredCharge>);
    await createWebhookReactor(p)(paidEvent(), charge, PLATFORM);
    expect(p.settlePayable).not.toHaveBeenCalled();
  });
});

describe('rule 3 — the activation charge settles before everything else', () => {
  it('consumes the delivery and settles no payable', async () => {
    const p = ports({ settleActivation: vi.fn().mockResolvedValue(true) });
    await createWebhookReactor(p)(paidEvent(), null, TENANT);
    expect(p.settleActivation).toHaveBeenCalledWith('ch_1', TENANT, 'pagbank');
    expect(p.settlePayable).not.toHaveBeenCalled();
  });
});

describe('rule 1 — a parked legacy notification resolves first', () => {
  it('reacts to what it yields and drops the original', async () => {
    const legacy = paidEvent({ eventId: 'evt_legacy', charge: { reference: 'ord_legacy' } });
    const p = ports({
      resolveLegacyEvents: vi.fn().mockResolvedValue([legacy]),
    });
    await createWebhookReactor(p)(paidEvent(), null, TENANT);
    expect(p.settlePayable).toHaveBeenCalledTimes(1);
    expect(p.settlePayable).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'ord_legacy' }),
    );
  });

  it('falls through to the ordinary path when nothing was parked', async () => {
    const p = ports({ resolveLegacyEvents: vi.fn().mockResolvedValue(null) });
    await createWebhookReactor(p)(paidEvent(), null, TENANT);
    expect(p.settlePayable).toHaveBeenCalledTimes(1);
  });
});
