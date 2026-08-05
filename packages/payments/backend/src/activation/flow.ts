import type { PaymentProviderAdapter } from '../core/provider';

/**
 * Which activation branch proves THIS adapter — chosen from capabilities,
 * never from a provider name (FUT-558).
 *
 * A REDIRECT provider's buyer pays on ITS page, so there is no card to
 * tokenize here and no public key to do it with: its proof is a real hosted
 * link (`startRedirectVerification` / `pollRedirectVerification`). Every
 * other tokenization has the host collect a card and charge it synchronously
 * (`verifyProviderCharge`). Rendering a card form a REDIRECT provider could
 * never satisfy produced a dead end that blamed the store — an instruction
 * that cannot work, for a key that was never going to exist.
 */
export function activationFlowOf(
  adapter: Pick<PaymentProviderAdapter, 'capabilities'>,
): 'CARD' | 'REDIRECT' {
  return adapter.capabilities.tokenization === 'REDIRECT' ? 'REDIRECT' : 'CARD';
}
