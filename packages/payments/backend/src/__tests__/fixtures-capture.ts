import { createPaymentsGateway } from '../core/gateway';
import type { PaymentProviderAdapter } from '../core/provider';
import { defineProviders } from '../core/registry';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { chargelessAdapter } from './fixtures';

/**
 * A gateway whose provider can capture an AUTHORIZED charge (FUT-4082).
 *
 * Same shape as `setupCancellingWorld`, in its own file because `fixtures.ts`
 * sits past its size budget: `capturing` is left unconnected, so a test
 * connects it, its raise answers AUTHORIZED, and the charge store is returned because the capture is only
 * half-done at the provider — the persisted row is the other half.
 */
/** The capturing provider's raise: a card AUTHORIZED, not captured, under a PagBank-style order. */
const authorize: PaymentProviderAdapter['createCharge'] = async (input) => ({
  provider: 'capturing',
  providerChargeId: `CHAR_${input.reference}`,
  reference: input.reference,
  status: 'AUTHORIZED',
  amount: input.amount,
  method: 'CARD',
  settlementHints: { orderId: `ORDE_${input.reference}` },
});

export function setupCapturingWorld(captureCharge: NonNullable<PaymentProviderAdapter['captureCharge']>) {
  const credentials = createMemoryCredentialStore();
  const charges = createMemoryChargeStore();
  const providers = defineProviders({
    capturing: { ...chargelessAdapter('capturing'), createCharge: authorize, captureCharge },
  } as const);
  const gateway = createPaymentsGateway({
    providers,
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
  });
  return { credentials, charges, gateway };
}
