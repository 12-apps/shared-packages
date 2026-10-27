import type { PaymentsGatewayConfig } from './gateway';
import { isManualConfirmation, refreshManualCharge } from './manual-charge';
import type { PaymentProviderAdapter } from './provider';
import type { SettlementHints } from './settlement-hints';
import type { ChargeSnapshot, MerchantRef, ResolvedCredentials } from './types';

/**
 * Re-read one charge from the provider and store what it says.
 *
 * The stored snapshot is where a hint learned at CREATION lives, and merging it
 * in is what makes the re-read answerable at all: InfinitePay's `payment_check`
 * will not confirm without the invoice `slug`. A CALLER's hints win — they
 * carry what only the return trip knows, the `transaction_nsu` that does not
 * exist until somebody has paid.
 */
export async function refreshOneCharge(
  config: Pick<PaymentsGatewayConfig, 'providers' | 'charges'>,
  resolve: (merchant: MerchantRef, provider?: string) => Promise<{ adapter: PaymentProviderAdapter; creds: ResolvedCredentials }>,
  merchant: MerchantRef,
  provider: string,
  providerChargeId: string,
  hints?: SettlementHints,
): Promise<ChargeSnapshot> {
  // A store-confirmed charge is read, never re-asked (`manual-charge.ts`) — and
  // read off the REGISTRY, so a store whose Pix manual settings were cleared
  // still answers its buyers' polls and its sweep.
  if (config.providers.has(provider) && isManualConfirmation(config.providers.get(provider))) {
    return refreshManualCharge(config.charges, merchant, provider, providerChargeId);
  }
  const { adapter, creds } = await resolve(merchant, provider);
  const stored = await config.charges.findByProviderChargeId(provider, providerChargeId);
  const merged = { ...stored?.snapshot.settlementHints, ...hints };
  const snapshot = await adapter.getCharge(providerChargeId, creds, merged);
  await config.charges.upsertByProviderChargeId(merchant, snapshot);
  return snapshot;
}
