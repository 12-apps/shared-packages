import { describe, expect, it, vi } from 'vitest';

import { createWebhookReactor, type WebhookReactorPorts } from '../core/webhook-reactor';
import type { ChargeTransaction, MerchantRef, NormalizedWebhookEvent, StoredCharge } from '../index';

/**
 * The settled transaction reaches the host (FUT-2239).
 *
 * A fiscal document links the payment that paid it by the transaction's own
 * ids. The reactor is the only place a webhook's snapshot meets the host's
 * settle, so it must hand those ids on — or the host would have to re-read the
 * stored snapshot JSON, and from there `raw`, which is the vendor's payload.
 * Backward compatible: a snapshot with no ids adds no key.
 */

const TENANT: MerchantRef = { kind: 'TENANT', id: 'store_1' };

function paidEvent(charge: Record<string, unknown> = {}): NormalizedWebhookEvent {
  return {
    eventId: 'evt_1',
    provider: 'pagbank',
    type: 'CHARGE_UPDATED',
    charge: {
      status: 'PAID',
      provider: 'pagbank',
      providerChargeId: 'ch_1',
      reference: 'ord_1',
      method: 'PIX',
      amount: { amountCents: 1000, currency: 'BRL' },
      ...charge,
    },
  } as unknown as NormalizedWebhookEvent;
}

function ports() {
  const spies = {
    settlePayable: vi.fn().mockResolvedValue(undefined),
    payableIsOpen: vi.fn().mockResolvedValue(true),
    parkReversal: vi.fn().mockResolvedValue(undefined),
    recordDispute: vi.fn().mockResolvedValue(undefined),
  };
  return spies as WebhookReactorPorts & typeof spies;
}

const PIX: ChargeTransaction = {
  endToEndId: 'ffab77a6818042e292e9bc1d0a51dbf2',
  settledAt: '2023-02-08T18:15:12.000Z',
  pspCnpjBase: '08561701',
};

describe('settlePayable carries the snapshot transaction', () => {
  it('passes the ids when nothing was stored', async () => {
    const p = ports();
    await createWebhookReactor(p)(paidEvent({ transaction: PIX }), null, TENANT);
    expect(p.settlePayable).toHaveBeenCalledWith({
      reference: 'ord_1',
      providerChargeId: 'ch_1',
      method: 'PIX',
      amountCents: 1000,
      transaction: PIX,
    });
  });

  it('passes them through the stored-charge path the sweep shares', async () => {
    const p = ports();
    const card: ChargeTransaction = { nsu: '032416400102', authorizationCode: '145803', pspCnpjBase: '08561701' };
    const stored = { reference: 'ord_1--2', merchant: TENANT, snapshot: {} } as unknown as StoredCharge;
    await createWebhookReactor(p)(paidEvent({ method: 'CARD', transaction: card }), stored, TENANT);
    expect(p.settlePayable).toHaveBeenCalledWith({
      reference: 'ord_1',
      providerChargeId: 'ch_1',
      method: 'CARD',
      amountCents: 1000,
      transaction: card,
    });
  });

  it('adds no transaction key when the provider named none', async () => {
    const p = ports();
    await createWebhookReactor(p)(paidEvent(), null, TENANT);
    expect(p.settlePayable.mock.calls[0]?.[0]).not.toHaveProperty('transaction');
  });
});
