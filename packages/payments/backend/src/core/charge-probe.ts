import type { ProbeResult } from './failover';
import type { PaymentProviderAdapter } from './provider';
import type { ChargeSnapshot, ResolvedCredentials } from './types';

/**
 * Statuses that mean the provider is holding — or has held — the buyer's
 * money. Finding one of these during a probe ends the walk: the charge
 * exists, so creating a second one elsewhere would bill the buyer twice.
 */
const LIVE_STATUSES: ReadonlySet<ChargeSnapshot['status']> = new Set([
  'PENDING',
  'AUTHORIZED',
  'PAID',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
]);

/**
 * The reconciliation probe: ask the provider whether the charge we could not
 * confirm actually exists.
 *
 * A thrown probe error is NOT converted to "no charge". That distinction is
 * the whole safety property — an unanswerable question must stop the walk,
 * never quietly authorize a second attempt elsewhere.
 */
export async function probe(
  adapter: PaymentProviderAdapter,
  reference: string,
  creds: ResolvedCredentials,
): Promise<{ result: ProbeResult; snapshot?: ChargeSnapshot; error?: unknown }> {
  if (!adapter.findChargeByReference) return { result: 'UNSUPPORTED' };
  try {
    const found = await adapter.findChargeByReference(reference, creds);
    if (!found) return { result: 'NOT_CHARGED' };
    // A charge that was canceled or expired never took the buyer's money and
    // never will, so it is not a reason to stop: the next provider can
    // safely be tried. Anything else is live money.
    if (!LIVE_STATUSES.has(found.status) && found.status !== 'DECLINED') {
      return { result: 'NOT_CHARGED', snapshot: found };
    }
    return { result: 'CHARGE_FOUND', snapshot: found };
  } catch (error) {
    return { result: 'PROBE_FAILED', error };
  }
}
