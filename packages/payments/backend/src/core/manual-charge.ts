import { PaymentsError, UnsupportedOperationError } from './errors';
import type { ChargeStore, StoredCharge, WebhookEventHandler } from './ports';
import type { PaymentProviderAdapter } from './provider';
import type { ChargeSnapshot, ChargeStatus, MerchantRef, ProviderName } from './types';

/**
 * Charges only the STORE can settle — a provider whose capabilities say
 * `confirmation: 'MANUAL'` (the store's own Pix key): nothing ever notifies us,
 * so PAID comes from a person pressing "Confirmar", and a refusal or a lapsed
 * window from the host.
 *
 * ## Every decision is one compare-and-set
 *
 * Confirm, refuse and expire all move the charge out of PENDING through
 * `ChargeStore.transitionPending`, never through the read-then-write upsert. Two
 * staff taps (Confirmar in one tab, Não recebi in another) can both read
 * PENDING; with the upsert both would win and the host would settle AND abandon
 * the same order. With the compare-and-set exactly one applies, and the loser
 * is told what the charge already is.
 *
 * ## Settling goes through the host's webhook handler — not the inbox
 *
 * A confirmation calls the gateway's `onWebhookEvent` with the stored PAID
 * charge, exactly what a provider's webhook reaches, so the host settles the
 * order the one way it knows (stock, notifications, comanda, cart). It skips
 * the webhook INBOX on purpose: the replay sweep re-runs `webhook.verify` over
 * a stored row, and a manual provider's `verify` refuses everything (so the
 * public webhook route can never forge a confirmation) — an inbox row could
 * never be replayed. Recovery is instead a second confirm: over a charge that
 * is already PAID it re-runs the handler, and the host settlement is idempotent.
 *
 * ## Reads never write
 *
 * `refreshManualCharge` answers the STORED snapshot and never calls the
 * adapter: its `getCharge` is PENDING forever, and written through the
 * unconditional upsert it could restate PENDING over a PAID a concurrent
 * confirm had just set.
 */


/** A manual decision over a charge that is no longer PENDING (already confirmed, refused or expired). */
export class ManualChargeNotPendingError extends PaymentsError {
  constructor(
    readonly provider: ProviderName,
    readonly providerChargeId: string,
    readonly status: ChargeStatus,
  ) {
    super('ManualChargeNotPendingError', `Charge ${providerChargeId} (${provider}) is ${status}, not PENDING.`);
  }
}

/** The charge a manual decision names does not exist for this merchant. */
export class ManualChargeNotFoundError extends PaymentsError {
  constructor(
    readonly provider: ProviderName,
    readonly providerChargeId: string,
  ) {
    super('ManualChargeNotFoundError', `No charge ${providerChargeId} (${provider}) for this merchant.`);
  }
}

/** The gateway members this module adds — merged into `PaymentsGateway`. */
export interface ManualChargeMethods<P extends string = string> {
  /**
   * The store saw the money: PENDING → PAID at the stored amount, then the
   * host's webhook handler settles the order. Over a charge already PAID it
   * re-runs the handler (recovery after a handler failure). Throws
   * `ManualChargeNotPendingError` over a refused or expired charge.
   */
  confirmManualCharge(merchant: MerchantRef, provider: P, providerChargeId: string): Promise<StoredCharge>;
  /** "Não recebi": PENDING → CANCELED. Throws over a PAID charge (the host must not abandon it). */
  refuseManualCharge(merchant: MerchantRef, provider: P, providerChargeId: string): Promise<StoredCharge>;
  /** The store's window lapsed: PENDING → EXPIRED. Throws over a PAID charge (the host must not expire it). */
  expireManualCharge(merchant: MerchantRef, provider: P, providerChargeId: string): Promise<StoredCharge>;
}

interface ManualChargeDeps {
  charges: ChargeStore;
  onWebhookEvent?: WebhookEventHandler;
  /**
   * The adapter by name — from the REGISTRY, not the credential resolver: a
   * decision needs only the adapter's capabilities, and a store that has just
   * switched Pix manual off must still be able to confirm the orders it took.
   */
  adapterOf: (provider: string) => PaymentProviderAdapter;
}

/** Whether an adapter's charges are settled by the store, not by the provider. */
export const isManualConfirmation = (adapter: PaymentProviderAdapter): boolean =>
  adapter.capabilities.confirmation === 'MANUAL';

function manualStore(deps: ManualChargeDeps, provider: string) {
  const adapter = deps.adapterOf(provider);
  if (!isManualConfirmation(adapter)) throw new UnsupportedOperationError(adapter.name, 'manual confirmation');
  const transition = deps.charges.transitionPending?.bind(deps.charges);
  if (!transition) throw new UnsupportedOperationError(adapter.name, 'manual confirmation without transitionPending');
  return transition;
}

async function storedFor(
  deps: ManualChargeDeps,
  merchant: MerchantRef,
  provider: string,
  providerChargeId: string,
): Promise<StoredCharge> {
  const stored = await deps.charges.findByProviderChargeId(provider, providerChargeId);
  const ours = stored && stored.merchant.kind === merchant.kind && stored.merchant.id === merchant.id;
  if (!stored || !ours) throw new ManualChargeNotFoundError(provider, providerChargeId);
  return stored;
}

/** The snapshot a decision writes: the stored one, at the stored amount, with a new status. */
const decided = (stored: StoredCharge, status: ChargeStatus): ChargeSnapshot => ({ ...stored.snapshot, status });

async function settle(deps: ManualChargeDeps, merchant: MerchantRef, charge: StoredCharge): Promise<StoredCharge> {
  await deps.onWebhookEvent?.(
    {
      provider: charge.provider,
      eventId: `manual-confirm:${charge.providerChargeId}`,
      type: 'CHARGE_UPDATED',
      charge: charge.snapshot,
    },
    charge,
    merchant,
  );
  return charge;
}

/** Move a PENDING charge to `status`; the loser of a race learns what the charge already is. */
async function decide(
  deps: ManualChargeDeps,
  merchant: MerchantRef,
  provider: string,
  providerChargeId: string,
  status: 'PAID' | 'CANCELED' | 'EXPIRED',
): Promise<{ applied: boolean; stored: StoredCharge }> {
  const transition = manualStore(deps, provider);
  const before = await storedFor(deps, merchant, provider, providerChargeId);
  const { applied, stored } = await transition(merchant, decided(before, status));
  if (!stored) throw new ManualChargeNotFoundError(provider, providerChargeId);
  return { applied, stored };
}

export function manualChargeMethods<P extends string>(deps: ManualChargeDeps): ManualChargeMethods<P> {
  return {
    async confirmManualCharge(merchant, provider, providerChargeId) {
      const { stored } = await decide(deps, merchant, provider, providerChargeId, 'PAID');
      if (stored.snapshot.status !== 'PAID') {
        throw new ManualChargeNotPendingError(provider, providerChargeId, stored.snapshot.status);
      }
      // Applied, or already PAID (a retry after the handler failed): settle either way.
      return settle(deps, merchant, stored);
    },
    async refuseManualCharge(merchant, provider, providerChargeId) {
      return closed(await decide(deps, merchant, provider, providerChargeId, 'CANCELED'), provider, providerChargeId);
    },
    async expireManualCharge(merchant, provider, providerChargeId) {
      return closed(await decide(deps, merchant, provider, providerChargeId, 'EXPIRED'), provider, providerChargeId);
    },
  };
}

/** Refuse/expire: done when applied or the charge is already closed (refused or expired); PAID refuses. */
function closed(
  outcome: { applied: boolean; stored: StoredCharge },
  provider: string,
  providerChargeId: string,
): StoredCharge {
  const status = outcome.stored.snapshot.status;
  if (outcome.applied || status === 'CANCELED' || status === 'EXPIRED') return outcome.stored;
  throw new ManualChargeNotPendingError(provider, providerChargeId, status);
}

/**
 * `refreshCharge` for a manual provider: the STORED snapshot, no adapter call,
 * no write. A missing row is a not-found, never a fallback to the adapter.
 */
export async function refreshManualCharge(
  charges: ChargeStore,
  merchant: MerchantRef,
  provider: string,
  providerChargeId: string,
): Promise<ChargeSnapshot> {
  const stored = await charges.findByProviderChargeId(provider, providerChargeId);
  const ours = stored && stored.merchant.kind === merchant.kind && stored.merchant.id === merchant.id;
  if (!stored || !ours) throw new ManualChargeNotFoundError(provider, providerChargeId);
  return stored.snapshot;
}
