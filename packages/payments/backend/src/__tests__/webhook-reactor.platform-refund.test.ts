import { describe, expect, it, vi } from 'vitest';

import { createWebhookReactor, type WebhookReactorPorts } from '../core/webhook-reactor';
import type { MerchantRef, NormalizedWebhookEvent } from '../index';

/**
 * A refund of a PLATFORM charge (a subscription payment returned, FUT-4864):
 * the provider's own word on it reaches the host — the only evidence a refund
 * FAILED, since a charge read cannot tell one still processing from one that
 * will never land. A TENANT delivery and a host without the port are untouched.
 */

const PLATFORM: MerchantRef = { kind: 'PLATFORM', id: 'platform' };
const TENANT: MerchantRef = { kind: 'TENANT', id: 'store_1' };

function refundEvent(status: 'PENDING' | 'REFUNDED' | 'FAILED'): NormalizedWebhookEvent {
  return {
    eventId: `evt_${status}`,
    provider: 'itau',
    type: 'REFUND_UPDATED',
    refund: {
      provider: 'itau',
      providerChargeId: 'ch_1',
      providerRefundId: 'rf_1',
      status,
      amount: { amountCents: 24900, currency: 'BRL' },
    },
  } as unknown as NormalizedWebhookEvent;
}

function ports(over: Partial<WebhookReactorPorts> = {}) {
  const spies = {
    settlePayable: vi.fn().mockResolvedValue(undefined),
    payableIsOpen: vi.fn().mockResolvedValue(true),
    settlePlatformPayment: vi.fn().mockResolvedValue(undefined),
    parkReversal: vi.fn().mockResolvedValue(undefined),
    recordDispute: vi.fn().mockResolvedValue(undefined),
    platformRefundUpdated: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  return spies as WebhookReactorPorts & typeof spies;
}

describe('a PLATFORM charge refund update', () => {
  it.each(['PENDING', 'REFUNDED', 'FAILED'] as const)('hands a %s refund to the host as the provider said it', async (status) => {
    const p = ports();
    await createWebhookReactor(p)(refundEvent(status), null, PLATFORM);
    expect(p.platformRefundUpdated).toHaveBeenCalledWith({
      provider: 'itau',
      providerChargeId: 'ch_1',
      providerRefundId: 'rf_1',
      status,
      amountCents: 24900,
    });
    expect(p.parkReversal).not.toHaveBeenCalled();
    expect(p.settlePlatformPayment).not.toHaveBeenCalled();
  });

  it('is ignored, as before, by a host without the port', async () => {
    const p = ports({ platformRefundUpdated: undefined });
    await expect(createWebhookReactor(p)(refundEvent('FAILED'), null, PLATFORM)).resolves.toBeUndefined();
    expect(p.parkReversal).not.toHaveBeenCalled();
  });

  it('never reaches the host for a TENANT refund, which stays a reversal', async () => {
    const p = ports({ referenceOf: vi.fn().mockResolvedValue('ord_1') });
    await createWebhookReactor(p)(refundEvent('REFUNDED'), null, TENANT);
    expect(p.platformRefundUpdated).not.toHaveBeenCalled();
    expect(p.parkReversal).toHaveBeenCalled();
  });
});
