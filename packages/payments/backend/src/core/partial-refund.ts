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
 * The gateway's gate for a refund that names an amount, before any HTTP call:
 * refused only when the provider refunds no method in part. Which method a
 * charge was paid with is the ADAPTER's to judge, from the provider's own
 * read-back: a stored row's method is not trusted here, because PagBank card
 * rows written before FUT-4571 read PIX, and the gate would refuse them all.
 */
export function assertPartialRefundAllowed(
  provider: string,
  caps: Pick<ProviderCapabilities, 'partialRefunds' | 'partialRefundMethods'>,
): void {
  if (caps.partialRefunds || (caps.partialRefundMethods?.length ?? 0) > 0) return;
  throw new UnsupportedOperationError(provider, 'partial refunds');
}
