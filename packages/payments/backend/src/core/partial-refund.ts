import { UnsupportedOperationError } from './errors';
import type { PaymentMethodKind, ProviderCapabilities } from './types';

/**
 * Can this provider refund PART of a charge paid with `method`? (FUT-4571)
 *
 * `partialRefunds` keeps meaning "every method", so a consumer that reads only
 * the boolean never sees a wider claim than before. `partialRefundMethods`
 * names the methods a provider refunds in part beyond it — a provider whose
 * Pix partial is unproven declares only `['CARD']`. This is the one reader of
 * the pair; ask it with the charge's method in hand.
 */
export function supportsPartialRefund(
  caps: Pick<ProviderCapabilities, 'partialRefunds' | 'partialRefundMethods'>,
  method: PaymentMethodKind,
): boolean {
  return caps.partialRefunds || (caps.partialRefundMethods?.includes(method) ?? false);
}

/**
 * The gateway's gate for a refund that names an amount, before any HTTP call.
 *
 * Refused when the provider refunds no method in part. When it names methods,
 * a STORED row's method decides; with no stored row the call goes on to the
 * adapter, which reads the charge back and refuses an unsupported method
 * itself before it sends anything.
 */
export function assertPartialRefundAllowed(
  provider: string,
  caps: Pick<ProviderCapabilities, 'partialRefunds' | 'partialRefundMethods'>,
  storedMethod: PaymentMethodKind | undefined,
): void {
  if (caps.partialRefunds) return;
  const named = caps.partialRefundMethods ?? [];
  if (named.length === 0 || (storedMethod !== undefined && !named.includes(storedMethod))) {
    throw new UnsupportedOperationError(provider, 'partial refunds');
  }
}
